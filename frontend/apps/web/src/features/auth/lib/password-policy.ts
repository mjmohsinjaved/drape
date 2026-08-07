/**
 * The S-6 password policy, mirrored client-side so the rules can be shown **before** the user
 * presses submit rather than reported back as a failure afterwards.
 *
 * The API is the authority: it answers `PASSWORD_POLICY_VIOLATION` regardless of what this
 * file believes. Everything here exists to save the user a round trip and to let the form
 * describe what a good password looks like while it is being typed.
 *
 * The rule, verbatim from §2.4: at least 10 characters, including a number and a symbol.
 */

/** §2.4 `PASSWORD_POLICY_VIOLATION`. */
export const MIN_PASSWORD_LENGTH = 10;

/** The three checks, in the order the form lists them. */
export const PASSWORD_RULES = ['length', 'number', 'symbol'] as const;

export type PasswordRule = (typeof PASSWORD_RULES)[number];

/** A comfortable ceiling: long passphrases are welcome, unbounded input is not. */
export const MAX_PASSWORD_LENGTH = 128;

/** Anything that is neither a letter nor a digit nor whitespace counts as a symbol. */
const SYMBOL_PATTERN = /[^\p{L}\p{N}\s]/u;
const DIGIT_PATTERN = /\p{N}/u;

export type PasswordRuleState = Record<PasswordRule, boolean>;

/** Which of the three rules the candidate currently satisfies. */
export function checkPasswordRules(value: string): PasswordRuleState {
  return {
    length: value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH,
    number: DIGIT_PATTERN.test(value),
    symbol: SYMBOL_PATTERN.test(value),
  };
}

export function meetsPasswordPolicy(value: string): boolean {
  const rules = checkPasswordRules(value);
  return rules.length && rules.number && rules.symbol;
}

/**
 * The 0–4 band `PasswordInput` draws. Scoring is policy, so it lives here rather than in the
 * design system — the meter reports a band and never blocks submission on its own.
 *
 * Three points for the policy itself, one more for genuine length. A password that does not
 * meet the policy can never read as "strong", which is the point.
 */
export function passwordStrength(value: string): 0 | 1 | 2 | 3 | 4 {
  if (value.length === 0) return 0;

  const rules = checkPasswordRules(value);
  const satisfied = Number(rules.length) + Number(rules.number) + Number(rules.symbol);

  if (satisfied < 3) return satisfied === 0 ? 0 : (Math.min(satisfied, 2) as 1 | 2);
  return value.length >= MIN_PASSWORD_LENGTH + 6 ? 4 : 3;
}

/** E.164 as `users.phone` stores it (§4.3) — the same pattern the API validates against. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value.trim());
}

/**
 * A deliberately permissive address check. The API owns the real rule; the form only needs
 * enough to catch a typo before spending a request on it, and a strict client-side regex
 * rejects valid addresses far more often than it catches invalid ones.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** The six-digit phone-OTP shape the API accepts (C-3). */
export const OTP_LENGTH = 6;

export function isOtpComplete(value: string): boolean {
  return new RegExp(`^\\d{${String(OTP_LENGTH)}}$`).test(value);
}
