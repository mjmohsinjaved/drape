import { Logger } from '@nestjs/common';

import axios from 'axios';
import sharp from 'sharp';

import { ErrorCode } from '@library/common';

import { TryOnConfig } from '../config/tryon.config';
import { fakeConfigService } from '../testing/tryon-harness';

import { GeminiTryOnProvider } from './gemini-tryon.provider';
import { isTryOnProviderError, type TryOnGenerationRequest } from './tryon-provider.interface';
import { isRetryableUpstreamCode } from './tryon-retry';

import type { AxiosResponse, CreateAxiosDefaults } from 'axios';

const API_KEY = 'not-a-real-key-AIzaSyDUMMY';
const MODEL = 'gemini-2.5-flash-image';

describe('GeminiTryOnProvider', () => {
  let post: jest.Mock;
  let clientDefaults: CreateAxiosDefaults | undefined;

  let pngBytes: Buffer;
  let webpBytes: Buffer;

  beforeAll(async () => {
    const source = sharp({
      create: { width: 4, height: 3, channels: 3, background: { r: 10, g: 20, b: 30 } },
    });
    pngBytes = await source.clone().png().toBuffer();
    webpBytes = await source.clone().webp().toBuffer();
  });

  function providerFor(overrides: Record<string, string | number> = {}): GeminiTryOnProvider {
    post = jest.fn();
    clientDefaults = undefined;
    jest.spyOn(axios, 'create').mockImplementation((config?: CreateAxiosDefaults) => {
      clientDefaults = config;
      return { post } as unknown as ReturnType<typeof axios.create>;
    });

    return new GeminiTryOnProvider(
      new TryOnConfig(
        fakeConfigService({
          TRYON_DRIVER: 'gemini',
          GEMINI_BASE_URL: 'https://generativelanguage.invalid/v1beta',
          GEMINI_API_KEY: API_KEY,
          GEMINI_IMAGE_MODEL: MODEL,
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

  function respond(status: number, body: unknown): AxiosResponse<ArrayBuffer> {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    return {
      status,
      data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      headers: { 'content-type': 'application/json', 'content-length': String(raw.byteLength) },
      statusText: '',
      config: {},
    } as unknown as AxiosResponse<ArrayBuffer>;
  }

  function imageAnswer(bytes: Buffer, mimeType = 'image/png'): unknown {
    return {
      candidates: [
        {
          content: { parts: [{ inlineData: { mimeType, data: bytes.toString('base64') } }] },
          finishReason: 'STOP',
        },
      ],
    };
  }

  async function failureOf(provider: GeminiTryOnProvider): Promise<{
    code: ErrorCode;
    status: number | undefined;
  }> {
    try {
      await provider.generate(request);
    } catch (error: unknown) {
      if (!isTryOnProviderError(error)) {
        throw error;
      }
      return { code: error.errorCode, status: error.status };
    }
    throw new Error('Expected generate() to reject.');
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a successful generation', () => {
    it('returns the PNG with its real dimensions and the attempt count', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      const result = await provider.generate(request);

      expect(result.png.equals(pngBytes)).toBe(true);
      expect(result.width).toBe(4);
      expect(result.height).toBe(3);
      expect(result.attempts).toBe(1);
    });

    it('posts to `/models/<model>:generateContent` with the key in the header, not the URL', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);

      const [path, , options] = post.mock.calls[0] as [string, unknown, { headers: Headers }];
      expect(path).toBe(`/models/${MODEL}:generateContent`);
      expect(path).not.toContain(API_KEY);
      expect((options.headers as unknown as Record<string, string>)['x-goog-api-key']).toBe(
        API_KEY,
      );
    });

    it('sends the person and the garment as labelled inline parts, and asks for an image', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);

      const [, body] = post.mock.calls[0] as [
        string,
        {
          contents: { parts: { text?: string; inlineData?: { data: string } }[] }[];
          generationConfig: { responseModalities: string[] };
        },
      ];
      const parts = body.contents[0]?.parts ?? [];
      const inline = parts.filter((part) => part.inlineData !== undefined);

      expect(inline).toHaveLength(2);
      expect(inline[0]?.inlineData?.data).toBe(request.personImage.toString('base64'));
      expect(inline[1]?.inlineData?.data).toBe(request.garmentImage.toString('base64'));
      expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
    });

    it('transcodes a non-PNG render, because the result is stored under a .png key', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(webpBytes, 'image/webp')));

      const result = await provider.generate(request);

      expect((await sharp(result.png).metadata()).format).toBe('png');
      expect(result.width).toBe(4);
      expect(result.height).toBe(3);
    });

    it('reads the proto-style `inline_data` spelling too', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, {
          candidates: [
            {
              content: {
                parts: [
                  { inline_data: { mimeType: 'image/png', data: pngBytes.toString('base64') } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
      );

      await expect(provider.generate(request)).resolves.toMatchObject({ width: 4 });
    });
  });

  describe('answers 200 with no image', () => {
    it('maps a blocked prompt to MODERATION_REJECTED', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, { promptFeedback: { blockReason: 'SAFETY' } }));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.MODERATION_REJECTED,
      });
    });

    it('maps finishReason IMAGE_SAFETY to MODERATION_REJECTED', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, { candidates: [{ content: { parts: [] }, finishReason: 'IMAGE_SAFETY' }] }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.MODERATION_REJECTED,
      });
    });

    it('maps a prose refusal to MODERATION_REJECTED rather than to a bare defect', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, {
          candidates: [
            {
              content: { parts: [{ text: "I'm sorry, I can't help with that request." }] },
              finishReason: 'STOP',
            },
          ],
        }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.MODERATION_REJECTED,
      });
    });

    it('maps "no garment is visible" to UPSTREAM_NO_GARMENT_DETECTED, so A-15 still fires', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, {
          candidates: [
            {
              content: { parts: [{ text: 'No garment is visible in the second image.' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
      });
    });

    it('falls back to UPSTREAM_INVALID_RESPONSE for an answer it cannot read at all', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, { candidates: [] }));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('rejects an empty image part instead of storing zero bytes as a render', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, {
          candidates: [
            {
              content: { parts: [{ inlineData: { mimeType: 'image/png', data: '' } }] },
              finishReason: 'STOP',
            },
          ],
        }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('rejects bytes that decode but are not an image', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(Buffer.from('not-an-image-at-all'))));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('rejects a success body that is not JSON', async () => {
      const provider = providerFor();
      const raw = Buffer.from('<html>502 Bad Gateway</html>');
      post.mockResolvedValue({
        status: 200,
        data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        headers: { 'content-type': 'text/html' },
      });

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });
  });

  describe('the §8.3 taxonomy over error statuses', () => {
    it.each([
      [400, 'INVALID_ARGUMENT', 'API key not valid', ErrorCode.TRYON_PROVIDER_MISCONFIGURED],
      [403, 'PERMISSION_DENIED', 'permission denied', ErrorCode.TRYON_PROVIDER_MISCONFIGURED],
      [429, 'RESOURCE_EXHAUSTED', 'quota exceeded', ErrorCode.UPSTREAM_RATE_LIMITED],
      [500, 'INTERNAL', 'internal error', ErrorCode.UPSTREAM_UNAVAILABLE],
      [503, 'UNAVAILABLE', 'the model is overloaded', ErrorCode.UPSTREAM_UNAVAILABLE],
      [504, 'DEADLINE_EXCEEDED', 'deadline exceeded', ErrorCode.UPSTREAM_TIMEOUT],
      [400, 'INVALID_ARGUMENT', 'unsupported mime type', ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT],
    ])('%s %s → %s', async (status, googleStatus, message, expected) => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(status, { error: { code: status, status: googleStatus, message } }),
      );

      const terminal =
        expected === ErrorCode.UPSTREAM_RATE_LIMITED ? ErrorCode.UPSTREAM_UNAVAILABLE : expected;

      await expect(failureOf(provider)).resolves.toMatchObject({ code: terminal });
    });

    it('classifies from the status alone when the error body is unparseable', async () => {
      const provider = providerFor();
      const raw = Buffer.from('upstream is having a bad day');
      post.mockResolvedValue({
        status: 401,
        data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        headers: {},
      });

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      });
    });
  });

  describe('transport failures', () => {
    it('reports an aborted socket as a timeout, whichever deadline won the race', async () => {
      for (const error of [
        Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }),
        Object.assign(new Error('canceled'), { name: 'CanceledError' }),
        Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
      ]) {
        const provider = providerFor();
        post.mockRejectedValue(error);

        await expect(failureOf(provider)).resolves.toMatchObject({
          code: ErrorCode.UPSTREAM_TIMEOUT,
        });
      }
    });

    it('reports an unreachable endpoint as UPSTREAM_UNAVAILABLE', async () => {
      const provider = providerFor();
      post.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), {
          isAxiosError: true,
          code: 'ECONNREFUSED',
        }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
      });
    });

    it('treats an axios size abort as malformed, so a memory bomb costs one attempt', async () => {
      const provider = providerFor();
      post.mockRejectedValue(new Error('maxContentLength size of 1000 exceeded'));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
      expect(post).toHaveBeenCalledTimes(1);
      expect(isRetryableUpstreamCode(ErrorCode.UPSTREAM_INVALID_RESPONSE)).toBe(false);
    });
  });

  describe('the bounded retry', () => {
    it('retries a 503 up to TRYON_MAX_ATTEMPTS and succeeds when one attempt does', async () => {
      const provider = providerFor();
      post
        .mockResolvedValueOnce(respond(503, { error: { status: 'UNAVAILABLE' } }))
        .mockResolvedValueOnce(respond(200, imageAnswer(pngBytes)));

      await expect(provider.generate(request)).resolves.toMatchObject({ attempts: 2 });
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('never retries a moderation refusal — the same image would be refused again, at cost', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, { promptFeedback: { blockReason: 'SAFETY' } }));

      await failureOf(provider);

      expect(post).toHaveBeenCalledTimes(1);
    });

    it('stops at TRYON_MAX_ATTEMPTS', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(503, { error: { status: 'UNAVAILABLE' } }));

      await failureOf(provider);

      expect(post).toHaveBeenCalledTimes(3);
    });
  });

  describe('the size bounds', () => {
    it('converts the byte ceiling through base64, because a 25 MB render is a 34 MB body', () => {
      providerFor({ TRYON_MAX_RESPONSE_BYTES: 3_000 });

      const expected = 4_000 + 64 * 1024;
      expect(clientDefaults?.maxContentLength).toBe(expected);
      expect(clientDefaults?.maxBodyLength).toBe(8_000 + 64 * 1024);
      expect(clientDefaults?.decompress).toBe(false);
      expect(clientDefaults?.maxRedirects).toBe(0);
    });

    it('rejects a decoded render over the configured ceiling, which the transport cap lets through', async () => {
      const provider = providerFor({ TRYON_MAX_RESPONSE_BYTES: 8 });
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('refuses a declared Content-Length over the transport cap', async () => {
      const provider = providerFor({ TRYON_MAX_RESPONSE_BYTES: 8 });
      const answer = respond(200, imageAnswer(pngBytes));
      (answer.headers as unknown as Record<string, string>)['content-length'] = '999999999';
      post.mockResolvedValue(answer);

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });
  });

  it('refuses to call at all when the driver is selected without credentials', async () => {
    const provider = providerFor({ GEMINI_API_KEY: '' });

    await expect(failureOf(provider)).resolves.toMatchObject({
      code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('never logs the API key, an image, or a base64 payload (E-12)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const provider = providerFor();
    post.mockResolvedValue(
      respond(400, {
        error: { code: 400, status: 'INVALID_ARGUMENT', message: 'unsupported mime type' },
      }),
    );

    await failureOf(provider);

    const logged = [...warn.mock.calls, ...error.mock.calls]
      .map((call) => String(call[0]))
      .join('\n');

    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain('SECRET-PERSON-BYTES');
    expect(logged).not.toContain(request.personImage.toString('base64'));
    expect(logged).not.toContain(pngBytes.toString('base64'));
    expect(logged).toContain('job-0001');
  });
});
