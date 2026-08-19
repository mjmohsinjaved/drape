import { Logger } from '@nestjs/common';

import axios from 'axios';
import sharp from 'sharp';

import { ErrorCode } from '@library/common';

import { OpenAiImageQuality } from '@api/config/env.validation';

import { TryOnConfig } from '../config/tryon.config';
import { fakeConfigService } from '../testing/tryon-harness';

import { OpenAiTryOnProvider } from './openai-tryon.provider';
import { isTryOnProviderError, type TryOnGenerationRequest } from './tryon-provider.interface';
import { isRetryableUpstreamCode } from './tryon-retry';

import type { AxiosResponse, CreateAxiosDefaults } from 'axios';

const API_KEY = 'sk-not-a-real-key-DUMMY';
const MODEL = 'gpt-image-2';
const BASE_URL = 'https://api.openai.invalid/v1';

describe('OpenAiTryOnProvider', () => {
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

  function providerFor(
    overrides: Record<string, string | number> = {},
    quality: OpenAiImageQuality = OpenAiImageQuality.MEDIUM,
  ): OpenAiTryOnProvider {
    post = jest.fn();
    clientDefaults = undefined;
    jest.spyOn(axios, 'create').mockImplementation((config?: CreateAxiosDefaults) => {
      clientDefaults = config;
      return { post } as unknown as ReturnType<typeof axios.create>;
    });

    return new OpenAiTryOnProvider(
      new TryOnConfig(
        fakeConfigService({
          TRYON_DRIVER: 'openai',
          OPENAI_BASE_URL: BASE_URL,
          OPENAI_API_KEY: API_KEY,
          OPENAI_IMAGE_MODEL: MODEL,
          TRYON_API_VERSION: 'test-0000-00-00',
          TRYON_TIMEOUT_MS: 50,
          TRYON_OPENAI_TIMEOUT_MS: 80,
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
      () => Promise.resolve(quality),
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

  function imageAnswer(bytes: Buffer): unknown {
    return { data: [{ b64_json: bytes.toString('base64') }] };
  }

  function errorAnswer(code: string, message: string, type = 'invalid_request_error'): unknown {
    return { error: { code, message, type, param: null } };
  }

  function formOf(index = 0): [string, string | Blob][] {
    const [, body] = post.mock.calls[index] as [string, FormData];
    return [...body.entries()] as [string, string | Blob][];
  }

  function valuesOf(field: string, index = 0): (string | Blob)[] {
    return formOf(index)
      .filter(([name]) => name === field)
      .map(([, value]) => value);
  }

  async function failureOf(provider: OpenAiTryOnProvider): Promise<{
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

    it('posts to /images/edits with the key as a bearer token, never in the URL', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);

      const [path, , options] = post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(path).toBe('/images/edits');
      expect(path).not.toContain(API_KEY);
      expect(options.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    });

    it('sends the person first and the garment second — the order carries the meaning', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);

      const images = valuesOf('image[]');
      expect(images).toHaveLength(2);

      const [person, garment] = images as [Blob, Blob];
      await expect(person.text()).resolves.toBe('SECRET-PERSON-BYTES');
      await expect(garment.text()).resolves.toBe('garment-bytes');
    });

    it('never sends `input_fidelity`, which this model rejects outright', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);

      expect(formOf().map(([field]) => field)).not.toContain('input_fidelity');
    });

    it('asks for one portrait PNG at the configured quality, with moderation relaxed', async () => {
      const provider = providerFor({}, OpenAiImageQuality.LOW);
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);

      const fields = new Map(formOf());
      expect(fields.get('model')).toBe(MODEL);
      expect(fields.get('n')).toBe('1');
      expect(fields.get('size')).toBe('1024x1536');
      expect(fields.get('quality')).toBe('low');
      expect(fields.get('moderation')).toBe('low');
      expect(fields.get('output_format')).toBe('png');
    });

    it('reads the quality dial per call, so an admin change lands without a restart', async () => {
      let quality = OpenAiImageQuality.LOW;
      post = jest.fn();
      jest
        .spyOn(axios, 'create')
        .mockImplementation(() => ({ post }) as unknown as ReturnType<typeof axios.create>);
      const provider = new OpenAiTryOnProvider(
        new TryOnConfig(
          fakeConfigService({
            TRYON_DRIVER: 'openai',
            OPENAI_BASE_URL: BASE_URL,
            OPENAI_API_KEY: API_KEY,
            OPENAI_IMAGE_MODEL: MODEL,
            TRYON_API_VERSION: 'test-0000-00-00',
            TRYON_TIMEOUT_MS: 50,
            TRYON_MAX_ATTEMPTS: 1,
            TRYON_BACKOFF_BASE_MS: 0,
            TRYON_TEST_RENDER_CONCURRENCY: 1,
            TRYON_MOCK_LATENCY_MS: 0,
            TRYON_MOCK_FAILURE_RATE: 0,
            TRYON_RATE_PER_HOUR: 20,
            TRYON_RATE_PER_IP_HOUR: 40,
          }),
        ),
        () => Promise.resolve(quality),
      );
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await provider.generate(request);
      quality = OpenAiImageQuality.HIGH;
      await provider.generate(request);

      expect(new Map(formOf(0)).get('quality')).toBe('low');
      expect(new Map(formOf(1)).get('quality')).toBe('high');
    });

    it('transcodes a non-PNG render, because the result is stored under a .png key', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, imageAnswer(webpBytes)));

      const result = await provider.generate(request);

      expect((await sharp(result.png).metadata()).format).toBe('png');
      expect(result.width).toBe(4);
      expect(result.height).toBe(3);
    });

    it('applies the OpenAI timeout, not the shared one — this upstream reasons first', async () => {
      providerFor();

      expect(clientDefaults?.timeout).toBe(80);
    });

    it('bounds the response for base64, not for raw bytes', async () => {
      const provider = providerFor({ TRYON_MAX_RESPONSE_BYTES: 3_000 });
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));
      await provider.generate(request);

      expect(clientDefaults?.maxContentLength).toBe(Math.ceil((3_000 * 4) / 3) + 64 * 1024);
      expect(clientDefaults?.decompress).toBe(false);
    });
  });

  describe('the error taxonomy (§8.3)', () => {
    it.each([
      ['moderation_blocked', 'Your request was rejected as a result of our safety system.', 400],
      ['content_policy_violation', 'This request violates our content policy.', 400],
    ])('maps %s to MODERATION_REJECTED', async (code, message, status) => {
      const provider = providerFor();
      post.mockResolvedValue(respond(status, errorAnswer(code, message)));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.MODERATION_REJECTED,
      });
    });

    it('never retries a moderation refusal — the same call would be refused again', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(400, errorAnswer('moderation_blocked', 'rejected by our safety system')),
      );

      await failureOf(provider);

      expect(post).toHaveBeenCalledTimes(1);
      expect(isRetryableUpstreamCode(ErrorCode.MODERATION_REJECTED)).toBe(false);
    });

    it('treats a 200 carrying a refusal as a refusal, not as a successful empty render', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, { data: [], refusal: 'I can’t help with editing photos of real people.' }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.MODERATION_REJECTED,
        status: 200,
      });
    });

    it('separates an exhausted balance from a rate limit, though both are 429', async () => {
      const exhausted = providerFor();
      post.mockResolvedValue(
        respond(
          429,
          errorAnswer(
            'insufficient_quota',
            'You exceeded your current quota, please check your plan and billing details.',
            'insufficient_quota',
          ),
        ),
      );
      await expect(failureOf(exhausted)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      });
      expect(post).toHaveBeenCalledTimes(1);

      const throttled = providerFor();
      post.mockResolvedValue(
        respond(429, errorAnswer('rate_limit_exceeded', 'Rate limit reached for images per min.')),
      );
      await expect(failureOf(throttled)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
      });
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('classifies the real "no credits remaining" body OpenAI returns', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(429, {
          error: {
            message:
              'You have no credits remaining. Add credits to continue using the API at ' +
              'https://platform.openai.com/settings/organization/billing/.',
            type: 'insufficient_quota',
            param: null,
            code: 'credit_balance_exhausted',
          },
        }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        status: 429,
      });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('classifies an exhausted balance from the `code` alone, without `type`', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(429, { error: { code: 'credit_balance_exhausted', message: 'no credits' } }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      });
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('reports an unverified organisation as misconfigured, not as a bad key', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(
          403,
          errorAnswer(
            'unsupported_model',
            'Your organization must be verified to use the model `gpt-image-2`.',
          ),
        ),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
        status: 403,
      });
    });

    it.each([
      [401, 'invalid_api_key', 'Incorrect API key provided.'],
      [404, 'model_not_found', 'The model `gpt-9` does not exist or you do not have access to it.'],
    ])('maps %s to TRYON_PROVIDER_MISCONFIGURED', async (status, code, message) => {
      const provider = providerFor();
      post.mockResolvedValue(respond(status, errorAnswer(code, message)));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      });
    });

    it('maps an unreadable upload to UPSTREAM_UNSUPPORTED_FORMAT', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(400, errorAnswer('invalid_image', 'The image could not be processed.')),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT,
      });
    });

    it('maps a 5xx to UPSTREAM_UNAVAILABLE and retries it to the ceiling', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(500, errorAnswer('server_error', 'The server had an error.', 'server_error')),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
      });
      expect(post).toHaveBeenCalledTimes(3);
    });

    it('reports a 200 with neither image nor refusal as a malformed response', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, { data: [] }));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('refuses a URL answer rather than fetching a consumer’s render from a third party', async () => {
      const provider = providerFor();
      post.mockResolvedValue(
        respond(200, { data: [{ url: 'https://cdn.openai.invalid/render.png' }] }),
      );

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('reports an empty image as malformed rather than storing zero bytes', async () => {
      const provider = providerFor();
      post.mockResolvedValue(respond(200, { data: [{ b64_json: '' }] }));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('reports a success body that is not JSON, but degrades an unparseable error body', async () => {
      const malformed = providerFor();
      const raw = Buffer.from('<html>gateway</html>', 'utf8');
      const notJson = {
        status: 200,
        data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        headers: { 'content-length': String(raw.byteLength) },
      } as unknown as AxiosResponse<ArrayBuffer>;
      post.mockResolvedValue(notJson);

      await expect(failureOf(malformed)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });

      const gateway = providerFor();
      post.mockResolvedValue({ ...notJson, status: 502 });

      await expect(failureOf(gateway)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
      });
    });
  });

  describe('bounds', () => {
    it('rejects a decoded render over the configured cap', async () => {
      const provider = providerFor({ TRYON_MAX_RESPONSE_BYTES: 4 });
      post.mockResolvedValue(respond(200, imageAnswer(pngBytes)));

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('rejects a response whose declared Content-Length is over the transport cap', async () => {
      const provider = providerFor({ TRYON_MAX_RESPONSE_BYTES: 8 });
      const answer = respond(200, imageAnswer(pngBytes));
      post.mockResolvedValue({
        ...answer,
        headers: { ...answer.headers, 'content-length': String(50 * 1024 * 1024) },
      });

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      });
    });

    it('classifies an axios size abort as malformed, so the bomb is not retried twice more', async () => {
      const provider = providerFor();
      post.mockRejectedValue(new Error('maxContentLength size of 1024 exceeded'));

      await failureOf(provider);

      expect(post).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['ECONNABORTED', ErrorCode.UPSTREAM_TIMEOUT],
      ['ERR_CANCELED', ErrorCode.UPSTREAM_TIMEOUT],
      ['ECONNREFUSED', ErrorCode.UPSTREAM_UNAVAILABLE],
    ])('classifies a transport %s correctly', async (code, expected) => {
      const provider = providerFor();
      const error = Object.assign(new Error('transport'), { isAxiosError: true, code });
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      post.mockRejectedValue(error);

      await expect(failureOf(provider)).resolves.toMatchObject({ code: expected });
    });

    it('refuses to call at all when the driver is not configured', async () => {
      const provider = providerFor({ OPENAI_API_KEY: '' });

      await expect(failureOf(provider)).resolves.toMatchObject({
        code: ErrorCode.TRYON_PROVIDER_MISCONFIGURED,
      });
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('logging (E-12)', () => {
    it('never logs the API key, the person bytes or a base64 payload', async () => {
      const written: string[] = [];
      const capture = (...args: unknown[]): void => void written.push(String(args[0]));
      for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
        jest.spyOn(Logger.prototype, level).mockImplementation(capture);
      }

      const provider = providerFor();
      post.mockResolvedValue(
        respond(400, errorAnswer('moderation_blocked', 'rejected by our safety system')),
      );
      await failureOf(provider);

      const all = written.join('\n');
      expect(all).not.toContain(API_KEY);
      expect(all).not.toContain('SECRET-PERSON-BYTES');
      expect(all).not.toContain(request.personImage.toString('base64'));
      expect(all).not.toContain(pngBytes.toString('base64'));
      expect(all).toContain('job-0001');
      expect(all).toContain(ErrorCode.MODERATION_REJECTED);
    });
  });
});
