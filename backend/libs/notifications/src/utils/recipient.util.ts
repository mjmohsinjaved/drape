/**
 * Cheap deliverability checks.
 *
 * The point is to fail an obviously undeliverable recipient before a provider, a timeout and three
 * retries are spent on it — not to validate an address exhaustively. Real validation is the
 * provider's job.
 */

/** Matches `notifications_outbox.recipientAddress` at `varchar(320)` (docs/ARCHITECTURE.md §4.32). */
export const MAX_EMAIL_LENGTH = 320;

const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>".]+(\.[^\s@,;<>".]+)+$/;

/** E.164: a leading `+`, a non-zero country digit, 7–15 digits in total. */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isLikelyEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(trimmed);
}

export function isE164PhoneNumber(value: string): boolean {
  return E164_PATTERN.test(value.trim());
}

/** Strips spaces and dashes so `+92 300 123 4567` reaches the gateway as `+923001234567`. */
export function normalisePhoneNumber(value: string): string {
  return value.trim().replace(/[\s-]/g, '');
}
