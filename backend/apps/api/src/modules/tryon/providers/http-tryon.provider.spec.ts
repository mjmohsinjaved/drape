import { Logger } from '@nestjs/common';

import axios from 'axios';
import sharp from 'sharp';

import { ErrorCode } from '@library/common';

import { DEFAULT_MAX_RESPONSE_BYTES, TryOnConfig } from '../config/tryon.config';
import { TRYON_FAILURE_POLICY } from '../services/tryon-failure.policy';
import { fakeConfigService } from '../testing/tryon-harness';

import { HttpTryOnProvider } from './http-tryon.provider';
import { isTryOnProviderError, type TryOnGenerationRequest } from './tryon-provider.interface';
import { isRetryableUpstreamCode } from './tryon-retry';

import type { AxiosResponse, CreateAxiosDefaults } from 'axios';

/**
 * `HttpTryOnProvider` — the real TryOnCloud client.
 *
 * **No test in this file makes a network call.** `axios.create` is stubbed, and the
 * driver is never selected by the suite's environment anyway
 * (`tryon-provider.factory.spec.ts` asserts that). What is exercised here is the part
 * that has to be right the first time it runs against the real upstream, because the
 * upstream has ten images in it: the classification of every response shape into the
 * §8.3 taxonomy, the timeout, the bounded retry, and — E-12 — that neither an image nor
 * the API key ever reaches a log line.
 */

const API_KEY = 'not-a-real-key-6f4a2b';

describe('HttpTryOnProvider', () => {
  let post: jest.Mock;
  /** What the provider asked axios for. The size bound lives here, so it is asserted here. */
  let clientDefaults: CreateAxiosDefaults | undefined;

  function providerFor(overrides: Record<string, string | number> = {}): HttpTryOnProvider {
    post = jest.fn();
    clientDefaults = undefined;
    jest.spyOn(axios, 'create').mockImplementation((config?: CreateAxiosDefaults) => {
      clientDefaults = config;
      return { post } as unknown as ReturnType<typeof axios.create>;
    });

    return new HttpTryOnProvider(
      new TryOnConfig(
        fakeConfigService({
          TRYON_DRIVER: 'http',
          TRYONCLOUD_BASE_URL: 'https://api.tryoncloud.invalid/v1',
          TRYONCLOUD_API_KEY: API_KEY,
          TRYON_API_VERSION: 'test-0000-00-00',
          TRYON_TIMEOUT_MS: 50,
          TRYON_MAX_ATTEMPTS: 3,
          TRYON_BACKOFF_BASE_MS: 0,
          TRYON_TEST_RENDER_CONCURRENCY: 1,
          TRYON_MOCK_LATENCY_MS: 0,
          TRYON_MOCK_FAILURE_RATE: 0,
          TRYON_RATE_PER_HOUR: 20,
          TRYON_RATE_PER_IP_HOUR: 40,
          ...overrides,
        }),
      ),
    );
  }

  const request: TryOnGenerationRequest = {
    garmentImage: Buffer.from('garment-bytes'),
    garmentImageMimeType: 'image/jpeg',
    personImage: Buffer.from('SECRET-PERSON-BYTES'),
    personImageMimeType: 'image/jpeg',
    correlationId: 'job-0001',
  };

  function respond(
    status: number,
    body: Buffer | string,
    contentType: string,
    extraHeaders: Record<string, string> = {},
  ): AxiosResponse<ArrayBuffer> {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    return {
      status,
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      headers: { 'content-type': contentType, ...extraHeaders },
      statusText: '',
      config: {},
    } as unknown as AxiosResponse<ArrayBuffer>;
  }

  async function pngBytes(): Promise<Buffer> {
    return sharp({
      create: { width: 8, height: 12, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
  }

  async function errorFrom(provider: HttpTryOnProvider): Promise<unknown> {
    return provider.generate(request).catch((error: unknown) => error);
  }

  it('identifies itself as the http driver', () => {
    expect(providerFor().name).toBe('http');
  });

  it('returns the PNG and its real dimensions on a 200', async () => {
    const provider = providerFor();
    post.mockResolvedValue(respond(200, await pngBytes(), 'image/png'));

    const result = await provider.generate(request);

    expect(result.width).toBe(8);
    expect(result.height).toBe(12);
    expect(result.attempts).toBe(1);
  });

  it('sends the key as a bearer header and the correlation id, and nothing else identifying', async () => {
    const provider = providerFor();
    post.mockResolvedValue(respond(200, await pngBytes(), 'image/png'));

    await provider.generate(request);

    const [, , config] = post.mock.calls[0] as [
      string,
      unknown,
      { headers: Record<string, string> },
    ];
    expect(config.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(config.headers['X-Correlation-Id']).toBe('job-0001');
    // A job id, never a user id, a photo id or a storage key (E-12).
    expect(JSON.stringify(config.headers)).not.toContain('person-photos/');
  });

  describe('classifying a response into the §8.3 taxonomy', () => {
    it.each([
      ['no_garment_detected', ErrorCode.UPSTREAM_NO_GARMENT_DETECTED],
      ['{"code":"garment_not_found"}', ErrorCode.UPSTREAM_NO_GARMENT_DETECTED],
      ['{"error":"moderation_failed"}', ErrorCode.MODERATION_REJECTED],
      ['{"error":"nsfw content"}', ErrorCode.MODERATION_REJECTED],
      ['{"code":"unsupported_format"}', ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT],
      ['{"code":"invalid_image"}', ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT],
    ])('reads %s as %s', async (body, expected) => {
      const provider = providerFor();
      post.mockResolvedValue(respond(422, body, 'application/json'));

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(expected);
    });

    it.each([
      [401, ErrorCode.TRYON_PROVIDER_MISCONFIGURED],
      [403, ErrorCode.TRYON_PROVIDER_MISCONFIGURED],
      [415, ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT],
      [400, ErrorCode.UPSTREAM_INVALID_RESPONSE],
    ])('falls back to the status when the body says nothing: %s → %s', async (status, expected) => {
      const provider = providerFor();
      post.mockResolvedValue(respond(status, '', 'application/json'));

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(expected);
    });

    it('treats a 5xx as UPSTREAM_UNAVAILABLE and retries it three times', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(503, 'upstream down', 'text/plain'));

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('retries a 429 silently and fails as UPSTREAM_UNAVAILABLE once attempts run out', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(429, 'slow down', 'text/plain'));

      const error = await errorFrom(provider);

      // §2.4: UPSTREAM_RATE_LIMITED is never surfaced.
      expect(isTryOnProviderError(error) && error.errorCode).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('recovers when a 503 is followed by a render', async () => {
      const provider = providerFor();
      post
        .mockResolvedValueOnce(respond(503, 'upstream down', 'text/plain'))
        .mockResolvedValueOnce(respond(200, await pngBytes(), 'image/png'));

      const result = await provider.generate(request);

      expect(result.attempts).toBe(2);
    });

    it('rejects an empty 200 as a malformed response rather than storing nothing', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, Buffer.alloc(0), 'image/png'));

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
      );
    });

    it('rejects a 200 whose bytes are not a readable image', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, 'this is not a png', 'image/png'));

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
      );
    });
  });

  /**
   * The response is bounded before it is classified.
   *
   * Every other test in this file inspects a body the process has already agreed to
   * hold. These are about the step before that: a compromised or hostile TryOnCloud
   * answering with a body designed to exhaust memory. axios buffers the whole thing
   * before `readResponse` can look at a status or a content type, `decompress: true`
   * would inflate a megabyte of gzip into gigabytes on the way, and three attempts
   * would do it three times — so the bound has to exist at the client, not in the
   * classification below it.
   */
  describe('bounding the response (E-11)', () => {
    const CAP = 1024;

    function cappedProvider(): HttpTryOnProvider {
      return providerFor({ TRYON_MAX_RESPONSE_BYTES: CAP });
    }

    it('gives axios a byte cap and turns transparent decompression off', () => {
      cappedProvider();

      expect(clientDefaults?.maxContentLength).toBe(CAP);
      // A gzip bomb is only a bomb once something inflates it.
      expect(clientDefaults?.decompress).toBe(false);
      // Neither may be left at the axios default of unlimited.
      expect(clientDefaults?.maxBodyLength).toBeGreaterThan(0);
      expect(clientDefaults?.maxBodyLength).not.toBe(Infinity);
    });

    it('leaves the request bound room for two images, so a real generation still fits', () => {
      cappedProvider();

      // The request carries the garment source *and* the person photo, both stored as
      // uploaded. Bounding it at the response cap would reject a legitimate generation
      // of two large pieces — a worse failure than the one being prevented.
      expect(clientDefaults?.maxBodyLength).toBeGreaterThanOrEqual(CAP * 2);
    });

    it('defaults the cap rather than leaving it unlimited when the variable is unset', () => {
      providerFor();

      expect(clientDefaults?.maxContentLength).toBe(DEFAULT_MAX_RESPONSE_BYTES);
      expect(clientDefaults?.maxBodyLength).toBeGreaterThanOrEqual(DEFAULT_MAX_RESPONSE_BYTES * 2);
    });

    it.each([
      ['a non-numeric value', 'unlimited'],
      // axios reads -1 and 0 as "no limit". A bound that fails open is the finding back.
      ['the axios sentinel for unlimited', -1],
      ['zero', 0],
      ['a fraction', 1.5],
    ])('falls back to the default rather than opening the bound for %s', (_case, raw) => {
      providerFor({ TRYON_MAX_RESPONSE_BYTES: raw });

      expect(clientDefaults?.maxContentLength).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    });

    it('asks for identity encoding, so the bytes measured are the bytes on the wire', async () => {
      const provider = cappedProvider();
      post.mockResolvedValue(respond(200, await pngBytes(), 'image/png'));

      await provider.generate(request);

      const [, , config] = post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers['Accept-Encoding']).toBe('identity');
    });

    it('refuses a body whose declared Content-Length exceeds the cap', async () => {
      const provider = cappedProvider();
      // The declaration alone is enough: a render is not 4 GB, whatever follows.
      post.mockResolvedValue(
        respond(200, await pngBytes(), 'image/png', { 'content-length': String(4 * 1024 ** 3) }),
      );

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
      );
    });

    it('refuses a body larger than the cap when no Content-Length is declared', async () => {
      const provider = cappedProvider();
      post.mockResolvedValue(respond(200, Buffer.alloc(CAP + 1, 0x89), 'image/png'));

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
      );
    });

    it('still accepts a render that sits exactly on the cap', async () => {
      const provider = providerFor({ TRYON_MAX_RESPONSE_BYTES: (await pngBytes()).length });
      post.mockResolvedValue(respond(200, await pngBytes(), 'image/png'));

      await expect(provider.generate(request)).resolves.toMatchObject({ width: 8, height: 12 });
    });

    it('reads axios cutting the stream off as malformed, not as a retryable outage', async () => {
      const provider = cappedProvider();
      post.mockRejectedValue(
        Object.assign(new Error(`maxContentLength size of ${CAP} exceeded`), {
          isAxiosError: true,
          code: 'ERR_BAD_RESPONSE',
        }),
      );

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(
        ErrorCode.UPSTREAM_INVALID_RESPONSE,
      );
    });

    it('spends one attempt on an oversized body, never TRYON_MAX_ATTEMPTS of them', async () => {
      const provider = cappedProvider();
      post.mockResolvedValue(respond(200, Buffer.alloc(CAP + 1, 0x89), 'image/png'));

      await errorFrom(provider);

      // Retrying a body sized to exhaust memory is the vulnerability, not the mitigation.
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('takes the §8.3 no-charge path: the code it fails with never reaches a charge', async () => {
      const provider = cappedProvider();
      post.mockResolvedValue(respond(200, Buffer.alloc(CAP + 1, 0x89), 'image/png'));

      const error = await errorFrom(provider);
      const code = isTryOnProviderError(error) ? error.errorCode : null;

      // PRD §8.3: "failed jobs never consume quota or budget". The guarantee is
      // structural — `QuotaPort.commitGeneration()` is reachable only from the
      // SUCCEEDED branch of `TryOnService.run()` — and it holds for this failure
      // because the failure is a taxonomy code, not a render. `tryon.service.spec.ts`
      // walks every code in the table and asserts `quota.charges` stays empty.
      expect(code).not.toBeNull();
      expect(code === null ? undefined : TRYON_FAILURE_POLICY[code]).toBeDefined();
      expect(code === null ? true : isRetryableUpstreamCode(code)).toBe(false);
    });

    it('never puts a byte of an oversized body into a log line (E-12)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const provider = cappedProvider();
      post.mockResolvedValue(
        respond(200, Buffer.from(`SECRET-PERSON-BYTES${'x'.repeat(CAP)}`), 'image/png'),
      );

      await errorFrom(provider);

      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).not.toContain('SECRET-PERSON-BYTES');
      expect(logged).toContain('job-0001');

      warn.mockRestore();
    });
  });

  describe('transport failures (E-11)', () => {
    it('classifies a timeout as UPSTREAM_TIMEOUT and retries it', async () => {
      const provider = providerFor();
      post.mockRejectedValue(
        Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }),
      );

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(ErrorCode.UPSTREAM_TIMEOUT);
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('classifies an unreachable host as UPSTREAM_UNAVAILABLE', async () => {
      const provider = providerFor();
      post.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), {
          isAxiosError: true,
          code: 'ECONNREFUSED',
        }),
      );

      const error = await errorFrom(provider);

      expect(isTryOnProviderError(error) && error.errorCode).toBe(ErrorCode.UPSTREAM_UNAVAILABLE);
    });

    it('refuses before any call when the driver is selected with no credentials', async () => {
      const provider = providerFor({ TRYONCLOUD_API_KEY: '' });

      const error = await errorFrom(provider);

      // Startup validation catches this first; this is §2.4's runtime backstop.
      expect(isTryOnProviderError(error) && error.errorCode).toBe(
        ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      );
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('E-12 — what reaches a log line', () => {
    it('never logs the API key, the images, or an echoed request body', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const provider = providerFor();
      // An upstream that echoes the request back is the nastiest case: the body would
      // carry the person's photograph into a log line if the snippet were unbounded.
      post.mockResolvedValue(respond(500, `SECRET-PERSON-BYTES${'x'.repeat(5_000)}`, 'text/plain'));

      await errorFrom(provider);

      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).not.toContain(API_KEY);
      expect(logged).not.toContain('SECRET-PERSON-BYTES');
      expect(logged).toContain('job-0001');

      warn.mockRestore();
    });

    it('does not read a binary error body into a string at all', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const provider = providerFor();
      post.mockResolvedValue(respond(500, request.personImage, 'application/octet-stream'));

      await errorFrom(provider);

      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).not.toContain('SECRET-PERSON-BYTES');

      warn.mockRestore();
    });
  });
});
