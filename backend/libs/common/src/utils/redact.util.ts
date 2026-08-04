/**
 * Log redaction — PRD E-12, ARCHITECTURE.md §8.1.
 *
 * "Structured logs carry the request id; **no photo URL, storage key, token or
 * personal data appears in any log line**."
 *
 * Everything that reaches a log line, an `audit_log.metadata` blob (§4.x) or a
 * notification debug payload goes through `redact()` first. The function is pure,
 * total and never throws: a redactor that can fail is a redactor that gets skipped.
 */

/** The placeholder written in place of a redacted value. */
export const REDACTED = '[REDACTED]';

const EMAIL_PLACEHOLDER = '[EMAIL]';
const PHONE_PLACEHOLDER = '[PHONE]';
const TOKEN_PLACEHOLDER = '[TOKEN]';
const STORAGE_KEY_PLACEHOLDER = '[STORAGE_KEY]';
const URL_PLACEHOLDER = '[URL]';

/** How deep `redact()` walks before collapsing a branch. */
export const MAX_REDACT_DEPTH = 8;

/** How many array elements `redact()` keeps before truncating. */
export const MAX_REDACT_ARRAY_LENGTH = 50;

/** How long a redacted string may be before it is truncated. */
export const MAX_REDACT_STRING_LENGTH = 512;

/**
 * Property names whose **value is dropped wholesale**, whatever it looks like.
 * Matching is case-insensitive and ignores `_`, `-` and `.` separators, so
 * `person_photo_url`, `personPhotoUrl` and `person.photo.url` all match.
 */
const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  // Credentials and secrets
  'password',
  'passwordhash',
  'secret',
  'apikey',
  'privatekey',
  'authorization',
  'cookie',
  'setcookie',
  'credential',
  'twofasecret',
  'csrfsecret',
  'sessionsecret',
  // Tokens of every flavour (§3.4 file tokens, invites, OTPs, resets)
  'token',
  'otp',
  'refreshtoken',
  'accesstoken',
  'sessiontoken',
  'uploadticket',
  'signature',
  // Personal data (E-12)
  'email',
  'phone',
  'mobile',
  'msisdn',
  'address',
  'useragent',
  // Storage keys and any URL that could resolve to a photo or a render (§3.4)
  'storagekey',
  'key',
  'url',
  'uri',
  'href',
  'src',
  'thumbnail',
  'photo',
  'render',
  'image',
  'download',
];

/**
 * Property names dropped on an **exact** match only.
 *
 * `ip` cannot be a substring rule: `description`, `recipient` and `multipart` all
 * contain it, and over-redacting those would gut the log lines that matter.
 */
const SENSITIVE_KEY_EXACT: ReadonlySet<string> = new Set([
  'ip',
  'ipaddress',
  'clientip',
  'remoteip',
  'remoteaddress',
  'xforwardedfor',
  'ua',
]);

/**
 * Property names that are safe even though they contain a sensitive fragment.
 * `emailVerifiedAt` is a timestamp, `emailHash` is already a one-way digest,
 * `cacheKey` is a sha256, `keyCount` is a number.
 */
const SAFE_KEY_EXACT: ReadonlySet<string> = new Set([
  'emailhash',
  'emailverified',
  'emailverifiedat',
  'phoneverified',
  'phoneverifiedat',
  'cachekey',
  'idempotencykey',
  'settingskey',
  'settingkey',
  'keycount',
  'imagecount',
  'photocount',
  'rendercount',
  'imagewidth',
  'imageheight',
  'urlttlseconds',
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Pakistani and international forms: `+92 300 1234567`, `0300-1234567`, `+1 (555) 123-4567`. */
const PHONE_PATTERN = /(?<![\w.-])\+?\d[\d\s().-]{7,17}\d(?![\w.-])/g;

/** Storage keys as built by `storage-key.builder.ts` (§3.3). */
const STORAGE_KEY_PATTERN =
  /\b(?:garments|categories|person-photos|renders|thumbnails|reference-models|brand)\/[A-Za-z0-9\-_/]*\.[A-Za-z0-9]{2,5}\b/g;

/** Any absolute URL. Photo and render URLs are signed file URLs, so all of them go. */
const URL_PATTERN = /\b(?:https?|ftp|file):\/\/[^\s"'<>)\]]+/gi;

/** A bare high-entropy token: hex, base64 or base64url, 32+ characters, no dashes. */
const OPAQUE_TOKEN_PATTERN = /(?<![\w-])[A-Za-z0-9_-]{32,}(?![\w-])/g;

/** A v4-shaped UUID — an opaque, non-personal identifier that stays readable in logs. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[_\-.\s]/g, '');
}

/** true when a property name means "drop the value". */
export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (SAFE_KEY_EXACT.has(normalised)) {
    return false;
  }
  if (SENSITIVE_KEY_EXACT.has(normalised)) {
    return true;
  }
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

/**
 * Redacts the sensitive substrings of a free-text string: emails, phone numbers,
 * absolute URLs, storage keys and opaque high-entropy tokens.
 *
 * UUIDs survive: they are unguessable identifiers, not personal data, and losing
 * them would make a log line useless for correlation (§2.4 masking relies on being
 * able to correlate a masked response with the true code by request id).
 */
export function redactString(value: string): string {
  if (UUID_PATTERN.test(value)) {
    return value;
  }

  const redacted = value
    // URLs first: a signed file URL contains both a storage-shaped path and a token.
    .replace(URL_PATTERN, URL_PLACEHOLDER)
    .replace(EMAIL_PATTERN, EMAIL_PLACEHOLDER)
    .replace(STORAGE_KEY_PATTERN, STORAGE_KEY_PLACEHOLDER)
    .replace(PHONE_PATTERN, PHONE_PLACEHOLDER)
    .replace(OPAQUE_TOKEN_PATTERN, (match) =>
      UUID_PATTERN.test(match) ? match : TOKEN_PLACEHOLDER,
    );

  return redacted.length > MAX_REDACT_STRING_LENGTH
    ? `${redacted.slice(0, MAX_REDACT_STRING_LENGTH)}…[TRUNCATED]`
    : redacted;
}

/** Replaces the local part of an email with `*`, keeping the domain for triage. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return EMAIL_PLACEHOLDER;
  }
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/** Keeps only the last two digits of a phone number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length < 4 ? PHONE_PLACEHOLDER : `***${digits.slice(-2)}`;
}

/**
 * Deep-redacts an arbitrary value for logging.
 *
 * - Values under a sensitive property name become `[REDACTED]` regardless of type.
 * - Strings are scrubbed of emails, phones, URLs, storage keys and opaque tokens.
 * - `Error` instances keep name and message (scrubbed) and drop the stack — stacks
 *   are logged separately, server-side only, by `GlobalExceptionFilter`.
 * - Cycles, over-deep branches and over-long arrays collapse to a marker rather
 *   than throwing.
 */
export function redact<T>(value: T): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}

/** `redact()` narrowed to a plain object — the shape a log line takes. */
export function redactObject(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = redact(value);
  return result !== null && typeof result === 'object' && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : { value: result };
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
    case 'boolean':
    case 'bigint':
      return typeof value === 'bigint' ? value.toString() : value;
    case 'function':
    case 'symbol':
      return `[${typeof value}]`;
    default:
      break;
  }

  if (depth >= MAX_REDACT_DEPTH) {
    return '[DEPTH_LIMIT]';
  }

  const asObject = value;
  if (seen.has(asObject)) {
    return '[CIRCULAR]';
  }
  seen.add(asObject);

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    // The stack is deliberately dropped: it is logged once, separately, by the
    // exception filter, and must never travel inside a redacted payload.
    return { name: value.name, message: redactString(value.message) };
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.byteLength}B]`;
  }

  if (Array.isArray(value)) {
    const truncated = value.length > MAX_REDACT_ARRAY_LENGTH;
    const items = (truncated ? value.slice(0, MAX_REDACT_ARRAY_LENGTH) : value).map((item) =>
      redactValue(item, depth + 1, seen),
    );
    if (truncated) {
      items.push(`[+${value.length - MAX_REDACT_ARRAY_LENGTH} more]`);
    }
    return items;
  }

  if (value instanceof Map) {
    const entries: Record<string, unknown> = {};
    for (const [key, entryValue] of value.entries()) {
      const name = String(key);
      entries[name] = isSensitiveKey(name) ? REDACTED : redactValue(entryValue, depth + 1, seen);
    }
    return entries;
  }

  if (value instanceof Set) {
    return redactValue(Array.from(value.values()), depth, seen);
  }

  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entryValue, depth + 1, seen);
  }
  return result;
}
