import {
  isSensitiveKey,
  maskEmail,
  maskPhone,
  MAX_REDACT_ARRAY_LENGTH,
  MAX_REDACT_STRING_LENGTH,
  redact,
  REDACTED,
  redactObject,
  redactString,
} from './redact.util';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'passwordHash',
    'sessionToken',
    'refresh_token',
    'apiKey',
    'twofaSecret',
    'authorization',
    'cookie',
    'email',
    'phoneNumber',
    'storageKey',
    'thumbnailUrl',
    'renderUrl',
    'photoKey',
    'downloadUrl',
    'ip',
    'ipAddress',
    'userAgent',
  ])('drops %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'id',
    'userId',
    'requestId',
    'statusCode',
    'errorCode',
    'durationMs',
    'emailHash',
    'emailVerifiedAt',
    'phoneVerifiedAt',
    'cacheKey',
    'idempotencyKey',
    'settingsKey',
    'imageWidth',
    'imageHeight',
    'photoCount',
    // 'ip' as a substring must not swallow ordinary words.
    'description',
    'recipient',
  ])('keeps %s', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it('ignores separators and casing', () => {
    expect(isSensitiveKey('API_KEY')).toBe(true);
    expect(isSensitiveKey('api-key')).toBe(true);
    expect(isSensitiveKey('api.key')).toBe(true);
  });
});

describe('redactString', () => {
  it('removes an email address', () => {
    expect(redactString('login failed for ayesha@example.com')).toBe('login failed for [EMAIL]');
  });

  it('removes a phone number', () => {
    expect(redactString('otp sent to +92 300 1234567')).toBe('otp sent to [PHONE]');
    expect(redactString('otp sent to 0300-1234567')).toBe('otp sent to [PHONE]');
  });

  it('removes a storage key', () => {
    expect(redactString('wrote person-photos/6f8b1a2c/abc.jpg')).toBe('wrote [STORAGE_KEY]');
    expect(redactString('renders/u1/9d0e.png missing')).toBe('[STORAGE_KEY] missing');
  });

  it('removes a signed file URL, token and all', () => {
    const line = 'GET http://localhost:4000/api/v1/files/eyJrZXkiOiJyZW5kZXJz.abcdef';
    expect(redactString(line)).toBe('GET [URL]');
  });

  it('removes a bare high-entropy token', () => {
    expect(redactString(`token=${'a1b2c3d4'.repeat(5)}`)).toBe('token=[TOKEN]');
  });

  it('keeps a uuid, which is how a log line stays correlatable', () => {
    const uuid = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';
    expect(redactString(uuid)).toBe(uuid);
    expect(redactString(`requestId ${uuid} done`)).toContain(uuid);
  });

  it('leaves ordinary prose alone', () => {
    expect(redactString('garment published successfully')).toBe('garment published successfully');
  });

  it('truncates a very long string', () => {
    // Prose, not a single long alphanumeric run: an unbroken run is itself
    // token-shaped, so it gets replaced wholesale and never reaches the
    // length check. Truncation is the last line of defence for genuinely
    // long log payloads, which are words.
    const long = 'garment published '.repeat(
      Math.ceil((MAX_REDACT_STRING_LENGTH + 100) / 'garment published '.length),
    );
    const result = redactString(long);
    expect(result.endsWith('…[TRUNCATED]')).toBe(true);
    expect(result.length).toBeLessThan(long.length);
  });
});

describe('redact', () => {
  it('drops values under a sensitive key, whatever their type', () => {
    expect(
      redact({ password: 'hunter2', apiKey: 12345, cookie: { a: 1 }, sessionToken: null }),
    ).toEqual({
      password: REDACTED,
      apiKey: REDACTED,
      cookie: REDACTED,
      sessionToken: REDACTED,
    });
  });

  it('keeps the identifiers an operator needs', () => {
    expect(
      redact({
        requestId: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c',
        userId: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
        errorCode: 'QUOTA_EXHAUSTED',
        statusCode: 403,
        durationMs: 42,
      }),
    ).toEqual({
      requestId: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c',
      userId: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
      errorCode: 'QUOTA_EXHAUSTED',
      statusCode: 403,
      durationMs: 42,
    });
  });

  it('scrubs sensitive substrings out of an innocently named field', () => {
    expect(redact({ note: 'call her on 0300-1234567 or ayesha@example.com' })).toEqual({
      note: 'call her on [PHONE] or [EMAIL]',
    });
  });

  it('walks nested structures', () => {
    expect(
      redact({
        job: { id: 'j1', result: { renderUrl: 'http://x/y.png', width: 1024 } },
      }),
    ).toEqual({ job: { id: 'j1', result: { renderUrl: REDACTED, width: 1024 } } });
  });

  it('redacts inside arrays', () => {
    expect(redact([{ email: 'a@b.com' }, { name: 'Zarrin' }])).toEqual([
      { email: REDACTED },
      { name: 'Zarrin' },
    ]);
  });

  it('truncates a long array rather than logging all of it', () => {
    const result = redact(Array.from({ length: MAX_REDACT_ARRAY_LENGTH + 10 }, (_, i) => i));
    expect(Array.isArray(result)).toBe(true);
    const items = result as unknown[];
    expect(items).toHaveLength(MAX_REDACT_ARRAY_LENGTH + 1);
    expect(items[MAX_REDACT_ARRAY_LENGTH]).toBe('[+10 more]');
  });

  it('collapses a cycle instead of overflowing the stack', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(redact(node)).toEqual({ name: 'root', self: '[CIRCULAR]' });
  });

  it('stops at the depth limit', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 12; i += 1) {
      deep = { child: deep };
    }
    expect(JSON.stringify(redact(deep))).toContain('[DEPTH_LIMIT]');
  });

  it('keeps an Error name and message but never its stack', () => {
    const error = new Error('upstream failed for ayesha@example.com');
    expect(redact(error)).toEqual({
      name: 'Error',
      message: 'upstream failed for [EMAIL]',
    });
  });

  it('summarises a Buffer instead of dumping its bytes', () => {
    expect(redact({ body: Buffer.alloc(1024) })).toEqual({ body: '[Buffer 1024B]' });
  });

  it('serialises dates as ISO strings', () => {
    expect(redact({ at: new Date('2026-08-05T09:14:22.113Z') })).toEqual({
      at: '2026-08-05T09:14:22.113Z',
    });
  });

  it('is safe on primitives, null and undefined', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(7)).toBe(7);
    expect(redact(true)).toBe(true);
  });

  it('never throws, whatever it is handed', () => {
    const nasty = {
      fn: (): void => undefined,
      sym: Symbol('x'),
      big: BigInt(9_007_199_254_740_993n),
      map: new Map([['email', 'a@b.com']]),
      set: new Set(['ayesha@example.com']),
    };
    expect(() => redact(nasty)).not.toThrow();
    const result = redact(nasty) as Record<string, unknown>;
    expect(result.fn).toBe('[function]');
    expect(result.map).toEqual({ email: REDACTED });
    expect(result.set).toEqual(['[EMAIL]']);
  });
});

describe('redactObject', () => {
  it('returns undefined for undefined', () => {
    expect(redactObject(undefined)).toBeUndefined();
  });

  it('returns a plain object for a plain object', () => {
    expect(redactObject({ period: '2026-08', email: 'a@b.com' })).toEqual({
      period: '2026-08',
      email: REDACTED,
    });
  });
});

describe('maskEmail / maskPhone', () => {
  it('masks the domain as well as the local part', () => {
    expect(maskEmail('ayesha@example.com')).toBe('a***a@e***e.com');
  });

  it('uses a fixed-width mask, so nothing leaks the length of what it hides', () => {
    expect(maskEmail('a@example.com')).toBe('***@e***e.com');
    expect(maskEmail('averyverylongaddress@example.com')).toBe('a***s@e***e.com');
  });

  it('collapses a non-address to the bare mask', () => {
    expect(maskEmail('not-an-address')).toBe('***');
  });

  it('keeps a dialling prefix and the last three digits of a phone number', () => {
    expect(maskPhone('+92 300 1234567')).toBe('+92***567');
    expect(maskPhone('03001234567')).toBe('03***567');
    expect(maskPhone('12')).toBe('***');
  });
});
