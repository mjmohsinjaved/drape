import { HttpStatus } from '@nestjs/common';

import {
  ALL_ERROR_CODES,
  ERROR_CODE_SPECS,
  ErrorCode,
  httpStatusForErrorCode,
  isErrorCode,
  isMaskedErrorCode,
  MASKED_ERROR_CODES,
  maskErrorCode,
} from './error-codes.constant';

/**
 * An independent transcription of the ARCHITECTURE.md §2.4 status column.
 *
 * This is deliberately a **second copy** of the table rather than a derivation of
 * `ERROR_CODE_SPECS` — a test that reads the implementation cannot catch a
 * transcription error, which is the failure mode that matters here.
 */
const EXPECTED_STATUS: Readonly<Record<ErrorCode, number>> = {
  // Authentication and session
  [ErrorCode.AUTH_REQUIRED]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.SESSION_INVALID]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.ACCOUNT_SUSPENDED]: 403,
  [ErrorCode.ACCOUNT_DEACTIVATED]: 403,
  [ErrorCode.EMAIL_NOT_VERIFIED]: 403,
  [ErrorCode.PHONE_NOT_VERIFIED]: 403,
  [ErrorCode.TWOFA_REQUIRED]: 401,
  [ErrorCode.TWOFA_INVALID]: 401,
  [ErrorCode.TWOFA_ALREADY_ENABLED]: 409,
  [ErrorCode.TWOFA_REQUIRED_FOR_ROLE]: 409,
  [ErrorCode.PASSWORD_POLICY_VIOLATION]: 400,
  [ErrorCode.TOKEN_INVALID]: 400,
  [ErrorCode.TOKEN_EXPIRED]: 410,
  [ErrorCode.TOKEN_ALREADY_USED]: 409,
  [ErrorCode.OTP_INVALID]: 400,
  [ErrorCode.OTP_EXPIRED]: 410,
  [ErrorCode.OTP_MAX_ATTEMPTS]: 429,
  [ErrorCode.CSRF_TOKEN_MISSING]: 403,
  [ErrorCode.CSRF_TOKEN_INVALID]: 403,
  [ErrorCode.INSUFFICIENT_ROLE]: 403,
  [ErrorCode.SELF_ROLE_CHANGE_FORBIDDEN]: 403,
  [ErrorCode.LAST_ADMIN_PROTECTED]: 409,
  [ErrorCode.BOT_CHECK_FAILED]: 403,

  // Invites and accounts
  [ErrorCode.EMAIL_ALREADY_EXISTS]: 409,
  [ErrorCode.PHONE_ALREADY_EXISTS]: 409,
  [ErrorCode.USER_NOT_FOUND]: 404,
  [ErrorCode.INVITE_NOT_FOUND]: 404,
  [ErrorCode.INVITE_EXPIRED]: 410,
  [ErrorCode.INVITE_ALREADY_CONSUMED]: 409,
  [ErrorCode.DELETION_IN_PROGRESS]: 409,

  // Try-on guard chain
  [ErrorCode.CONSENT_REQUIRED]: 403,
  [ErrorCode.CONSENT_STALE]: 403,
  [ErrorCode.QUOTA_EXHAUSTED]: 403,
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.BUDGET_EXHAUSTED]: 403,
  [ErrorCode.GARMENT_NOT_PUBLISHED]: 404,
  [ErrorCode.TEST_RENDER_REQUIRED]: 409,
  [ErrorCode.PHOTO_NOT_OWNED]: 403,
  [ErrorCode.IDEMPOTENCY_IN_FLIGHT]: 409,

  // Ownership codes — masked
  [ErrorCode.RESULT_NOT_OWNED]: 403,
  [ErrorCode.JOB_NOT_OWNED]: 403,
  [ErrorCode.ENQUIRY_NOT_OWNED]: 403,
  [ErrorCode.SHORTLIST_ITEM_NOT_OWNED]: 403,
  [ErrorCode.SHARE_LINK_NOT_OWNED]: 403,

  // Upstream
  [ErrorCode.UPSTREAM_NO_GARMENT_DETECTED]: 502,
  [ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT]: 422,
  [ErrorCode.MODERATION_REJECTED]: 422,
  [ErrorCode.UPSTREAM_TIMEOUT]: 504,
  [ErrorCode.UPSTREAM_UNAVAILABLE]: 503,
  [ErrorCode.UPSTREAM_RATE_LIMITED]: 503,
  [ErrorCode.UPSTREAM_INVALID_RESPONSE]: 502,
  [ErrorCode.TRYON_PROVIDER_MISCONFIGURED]: 503,

  // Catalog, garments, images
  [ErrorCode.CATEGORY_NOT_FOUND]: 404,
  [ErrorCode.CATEGORY_HAS_PUBLISHED_GARMENTS]: 409,
  [ErrorCode.CATEGORY_DEPTH_EXCEEDED]: 400,
  [ErrorCode.CATEGORY_ARCHIVED]: 409,
  [ErrorCode.GARMENT_NOT_FOUND]: 404,
  [ErrorCode.GARMENT_SKU_EXISTS]: 409,
  [ErrorCode.INVALID_PUBLISH_TRANSITION]: 409,
  [ErrorCode.TRYON_SOURCE_REQUIRED]: 409,
  [ErrorCode.TRYON_SOURCE_ALREADY_SET]: 409,
  [ErrorCode.GARMENT_QUALITY_BELOW_THRESHOLD]: 422,
  [ErrorCode.QUALITY_OVERRIDE_REQUIRED]: 409,
  [ErrorCode.IMAGE_TOO_SMALL]: 422,
  [ErrorCode.IMAGE_FORMAT_UNSUPPORTED]: 415,
  [ErrorCode.IMAGE_TOO_LARGE]: 413,
  [ErrorCode.IMAGE_CORRUPT]: 422,
  [ErrorCode.BULK_OPERATION_PARTIAL_FAILURE]: 207,

  // Photos, consent, results, engagement
  [ErrorCode.CONSENT_POLICY_NOT_FOUND]: 404,
  [ErrorCode.PHOTO_LIMIT_REACHED]: 409,
  [ErrorCode.PHOTO_VALIDATION_FAILED]: 422,
  [ErrorCode.PHOTO_BLOCKED_BY_MODERATION]: 403,
  [ErrorCode.PHOTO_NOT_FOUND]: 404,
  [ErrorCode.RESULT_NOT_FOUND]: 404,
  [ErrorCode.JOB_NOT_FOUND]: 404,
  [ErrorCode.SHORTLIST_ITEM_NOT_FOUND]: 404,
  [ErrorCode.SHORTLIST_EMPTY]: 409,
  [ErrorCode.SHARE_LINK_NOT_FOUND]: 404,
  [ErrorCode.SHARE_LINK_REVOKED]: 410,
  [ErrorCode.SHARE_LINK_EXPIRED]: 410,
  [ErrorCode.SHARING_DISABLED]: 403,
  [ErrorCode.VOTE_ALREADY_CAST]: 409,
  [ErrorCode.ENQUIRIES_DISABLED]: 403,
  [ErrorCode.ENQUIRY_NOT_FOUND]: 404,
  [ErrorCode.ENQUIRY_ALREADY_OPEN]: 409,
  [ErrorCode.ENQUIRY_LOST_REASON_REQUIRED]: 400,
  [ErrorCode.INVALID_ENQUIRY_TRANSITION]: 409,

  // Quota, moderation, settings, files, platform
  [ErrorCode.QUOTA_ADJUSTMENT_INVALID]: 400,
  [ErrorCode.MODERATION_ITEM_NOT_FOUND]: 404,
  [ErrorCode.MODERATION_ALREADY_REVIEWED]: 409,
  [ErrorCode.IP_BLOCKED]: 403,
  [ErrorCode.SETTINGS_KEY_UNKNOWN]: 400,
  [ErrorCode.SETTINGS_VALUE_INVALID]: 400,
  [ErrorCode.FILE_TOKEN_INVALID]: 403,
  [ErrorCode.FILE_TOKEN_EXPIRED]: 403,
  [ErrorCode.FILE_TOKEN_SUBJECT_MISMATCH]: 403,
  [ErrorCode.FILE_NOT_FOUND]: 404,
  [ErrorCode.UPLOAD_TICKET_INVALID]: 403,
  [ErrorCode.UPLOAD_TICKET_EXPIRED]: 410,
  [ErrorCode.STORAGE_WRITE_FAILED]: 500,
  [ErrorCode.STORAGE_PATH_REJECTED]: 400,
  [ErrorCode.EXPORT_NOT_READY]: 409,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ErrorCode.RESOURCE_CONFLICT]: 409,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

/** PRD §8.3 verbatim strings, marked ✔︎ in §2.4. These must match character for character. */
const PRD_VERBATIM: Array<[ErrorCode, string]> = [
  [
    ErrorCode.QUOTA_EXHAUSTED,
    "You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time.",
  ],
  [
    ErrorCode.BUDGET_EXHAUSTED,
    "Our fitting room is at capacity today — we'll email you when it's back.",
  ],
  [
    ErrorCode.UPSTREAM_NO_GARMENT_DETECTED,
    "We're having trouble with this piece — we've been notified. Try another for now.",
  ],
  [ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT, "That photo didn't upload properly. Mind trying again?"],
  [ErrorCode.UPSTREAM_TIMEOUT, 'Taking longer than usual — hang tight.'],
  [ErrorCode.UPSTREAM_UNAVAILABLE, 'Taking longer than usual — hang tight.'],
];

describe('ErrorCode', () => {
  it('gives every enum member a value identical to its key', () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
    }
  });

  it('has exactly one ERROR_CODE_SPECS entry per member, and no extras', () => {
    const specKeys = Object.keys(ERROR_CODE_SPECS).sort();
    const enumKeys = [...ALL_ERROR_CODES].sort();
    expect(specKeys).toEqual(enumKeys);
  });

  it('gives every code a non-empty message', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(ERROR_CODE_SPECS[code].message.trim().length).toBeGreaterThan(0);
    }
  });

  it('never leaks a placeholder into a message that has no interpolation contract', () => {
    const withPlaceholders = ALL_ERROR_CODES.filter((code) =>
      /\{[a-zA-Z]+\}/.test(ERROR_CODE_SPECS[code].message),
    );
    // §2.4 documents exactly these braced messages.
    expect(withPlaceholders.sort()).toEqual(
      [
        ErrorCode.INVALID_PUBLISH_TRANSITION,
        ErrorCode.IMAGE_TOO_SMALL,
        ErrorCode.IMAGE_TOO_LARGE,
        ErrorCode.PHOTO_LIMIT_REACHED,
        ErrorCode.INVALID_ENQUIRY_TRANSITION,
        ErrorCode.QUOTA_ADJUSTMENT_INVALID,
      ].sort(),
    );
  });
});

describe('ERROR_CODE_SPECS status mapping', () => {
  it.each(ALL_ERROR_CODES.map((code) => [code]))('%s maps to the §2.4 HTTP status', (code) => {
    expect(ERROR_CODE_SPECS[code].status).toBe(EXPECTED_STATUS[code]);
  });

  it('covers exactly the declared codes in the expected-status table', () => {
    expect(Object.keys(EXPECTED_STATUS).sort()).toEqual([...ALL_ERROR_CODES].sort());
  });

  it('only uses statuses in the 2xx–5xx range', () => {
    for (const code of ALL_ERROR_CODES) {
      const status = ERROR_CODE_SPECS[code].status;
      expect(status).toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(600);
    }
  });

  it('agrees with NestJS HttpStatus for the codes it defines', () => {
    expect(ERROR_CODE_SPECS[ErrorCode.AUTH_REQUIRED].status).toBe(HttpStatus.UNAUTHORIZED);
    expect(ERROR_CODE_SPECS[ErrorCode.INSUFFICIENT_ROLE].status).toBe(HttpStatus.FORBIDDEN);
    expect(ERROR_CODE_SPECS[ErrorCode.INTERNAL_ERROR].status).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});

describe('PRD §8.3 verbatim copy', () => {
  it.each(PRD_VERBATIM)('%s is reproduced character for character', (code, expected) => {
    expect(ERROR_CODE_SPECS[code].message).toBe(expected);
  });

  it('uses the same copy for SESSION_EXPIRED and SESSION_INVALID, so neither is revealed', () => {
    expect(ERROR_CODE_SPECS[ErrorCode.SESSION_EXPIRED].message).toBe(
      ERROR_CODE_SPECS[ErrorCode.SESSION_INVALID].message,
    );
  });

  it('uses identical copy for MODERATION_REJECTED and PHOTO_BLOCKED_BY_MODERATION', () => {
    expect(ERROR_CODE_SPECS[ErrorCode.MODERATION_REJECTED].message).toBe(
      ERROR_CODE_SPECS[ErrorCode.PHOTO_BLOCKED_BY_MODERATION].message,
    );
  });
});

describe('MASKED_ERROR_CODES', () => {
  it('maps exactly the six §2.4 ownership codes', () => {
    expect(MASKED_ERROR_CODES).toEqual({
      [ErrorCode.PHOTO_NOT_OWNED]: ErrorCode.PHOTO_NOT_FOUND,
      [ErrorCode.RESULT_NOT_OWNED]: ErrorCode.RESULT_NOT_FOUND,
      [ErrorCode.JOB_NOT_OWNED]: ErrorCode.JOB_NOT_FOUND,
      [ErrorCode.ENQUIRY_NOT_OWNED]: ErrorCode.ENQUIRY_NOT_FOUND,
      [ErrorCode.SHORTLIST_ITEM_NOT_OWNED]: ErrorCode.SHORTLIST_ITEM_NOT_FOUND,
      [ErrorCode.SHARE_LINK_NOT_OWNED]: ErrorCode.SHARE_LINK_NOT_FOUND,
    });
  });

  it('masks every *_NOT_OWNED code, and nothing else', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(isMaskedErrorCode(code)).toBe(code.endsWith('_NOT_OWNED'));
    }
  });

  it('turns each 403 ownership code into a 404 the client cannot distinguish', () => {
    for (const [trueCode, maskedCode] of Object.entries(MASKED_ERROR_CODES)) {
      expect(ERROR_CODE_SPECS[trueCode as ErrorCode].status).toBe(403);
      expect(ERROR_CODE_SPECS[maskedCode].status).toBe(404);
      expect(httpStatusForErrorCode(trueCode as ErrorCode)).toBe(404);
    }
  });

  it('never masks a code onto another masked code', () => {
    for (const maskedCode of Object.values(MASKED_ERROR_CODES)) {
      expect(isMaskedErrorCode(maskedCode)).toBe(false);
    }
  });

  it('gives every ownership code a spec, so logs and metrics can name it', () => {
    for (const code of Object.keys(MASKED_ERROR_CODES)) {
      const spec = ERROR_CODE_SPECS[code as ErrorCode];
      expect(spec.message).toBe("You don't have access to this.");
      expect(spec.consumerFacing).toBe(false);
    }
  });

  it('leaves an unmasked code untouched', () => {
    expect(maskErrorCode(ErrorCode.QUOTA_EXHAUSTED)).toBe(ErrorCode.QUOTA_EXHAUSTED);
  });
});

describe('isErrorCode', () => {
  it('accepts declared codes', () => {
    expect(isErrorCode('QUOTA_EXHAUSTED')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isErrorCode('NOT_A_CODE')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(404)).toBe(false);
    // Prototype keys must not be mistaken for members.
    expect(isErrorCode('toString')).toBe(false);
  });
});
