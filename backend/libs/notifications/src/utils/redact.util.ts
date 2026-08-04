import { type NotificationChannelName } from '../interfaces/send-result.interface';

/**
 * Recipient masking.
 *
 * No raw address or number ever reaches a log line, a metric or a `SendResult`. The mask is a fixed
 * three characters, so it does not leak the length of what it hides either.
 */
const MASK = '***';

function maskLabel(value: string): string {
  if (value.length < 2) {
    return MASK;
  }
  return `${value[0]}${MASK}${value[value.length - 1]}`;
}

/** `alice@example.com` → `a***e@e***e.com`. Anything unparseable collapses to `***`. */
export function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return MASK;
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0)) {
    return `${maskLabel(local)}@${MASK}`;
  }

  const tld = labels[labels.length - 1];
  const masked = labels.slice(0, -1).map(maskLabel).join('.');
  return `${maskLabel(local)}@${masked}.${tld}`;
}

/** `+923001234567` → `+92***567`. Anything with too few digits collapses to `***`. */
export function maskPhone(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) {
    return MASK;
  }
  const head = digits.slice(0, 2);
  const tail = digits.slice(-3);
  return `${hasPlus ? '+' : ''}${head}${MASK}${tail}`;
}

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
