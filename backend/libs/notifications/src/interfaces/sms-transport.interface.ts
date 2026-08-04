/**
 * Wire shape for the generic REST SMS driver.
 *
 * Kept in its own file so `notifications-options.interface.ts` and `http-sms.provider.ts` can share
 * it without an import cycle.
 */
export type SmsRequestBodyValue = string | number | boolean | null;

export type SmsRequestBody = Record<string, SmsRequestBodyValue>;
