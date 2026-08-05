import { maskEmail, maskPhone } from '@library/common';

import { type NotificationChannelName } from '../interfaces/send-result.interface';

/**
 * Recipient masking.
 *
 * No raw address or number ever reaches a log line, a metric or a `SendResult`.
 *
 * The masks themselves live in `@library/common` and are **re-exported** here, so a file
 * that reaches for `@library/notifications` and a file that reaches for `@library/common`
 * cannot end up applying two different policies to the same address. This barrel keeps
 * only what is notification-specific: the channel dispatch and the provider-message
 * summariser.
 */
export { maskEmail, maskPhone } from '@library/common';

/** Masks by channel, so callers never have to pick the right function. */
export function maskRecipient(channel: NotificationChannelName, value: string): string {
  return channel === 'EMAIL' ? maskEmail(value) : maskPhone(value);
}

/**
 * Trims a provider message down to something safe for `notifications_outbox.lastError`
 * (`varchar(512)`, docs/ARCHITECTURE.md §4.32) and strips anything that looks like an address.
 */
export function summariseProviderMessage(message: string, maxLength = 480): string {
  const withoutAddresses = message
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (match) => maskEmail(match))
    .replace(/\+\d[\d\s-]{5,}\d/g, (match) => maskPhone(match));
  const collapsed = withoutAddresses.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`;
}
