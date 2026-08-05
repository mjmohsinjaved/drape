import type { TemplateId, TemplatePropsMap } from '@library/notifications';

/**
 * The one place a stored `notifications_outbox.payload` becomes template props again.
 *
 * ### The problem this solves, honestly
 *
 * `enqueue()` is generic on the template id, so the props handed in are checked
 * against `TemplatePropsMap[K]` at the call site. `jsonb` then erases all of it: what
 * comes back out of the column is `Record<string, unknown>`, and a `Date` written into
 * it comes back as an ISO string. Two things therefore have to happen before the
 * registry can render the row, and both of them belong here rather than scattered
 * through the processor:
 *
 *  1. **Dates are revived.** Every template that shows a date calls `formatDateTime`,
 *     which needs a `Date`. A string would render as `Invalid Date` in a consumer's
 *     inbox, and the failure would be silent — the send would "succeed".
 *  2. **The type is re-asserted, exactly once.** There is no runtime schema for
 *     seventeen prop shapes and inventing one would be a second source of truth for
 *     copy that already has one. The assertion is confined to {@link storedProps} so a
 *     reviewer can find every place it happens by finding this function's callers.
 *
 * A payload that is genuinely the wrong shape for its template surfaces as a render
 * failure in the processor, which is retried and then dead-lettered like any other
 * delivery failure — it does not take down the tick.
 */

/**
 * ISO-8601 with a time component. Deliberately strict: a bare `2026-08-04` is a
 * calendar date in this codebase (§4.0 rule 2) and several templates legitimately
 * carry one as a string, so only a full timestamp is revived.
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** How deep {@link reviveTimestamps} will walk. Template props are flat or nearly so. */
const MAX_DEPTH = 6;

/** true when `value` is a JSON string that was a `Date` before it was serialised. */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Walks a decoded `jsonb` value and turns every ISO timestamp string back into a
 * `Date`. Arrays and nested objects are handled; anything else is returned unchanged.
 */
export function reviveTimestamps(value: unknown, depth = 0): unknown {
  if (isIsoTimestamp(value)) {
    return new Date(value);
  }
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => reviveTimestamps(item, depth + 1));
  }

  const revived: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    revived[key] = reviveTimestamps(item, depth + 1);
  }
  return revived;
}

/**
 * A stored payload, ready to hand to the template registry.
 *
 * The return type is the **union** of every template's props rather than one of them,
 * because the row only knows its template id at runtime. `NotificationsService`
 * `renderTemplate<K>` instantiated at `K = TemplateId` accepts exactly that union.
 */
export function storedProps(payload: Record<string, unknown>): TemplatePropsMap[TemplateId] {
  return reviveTimestamps(payload) as TemplatePropsMap[TemplateId];
}

/**
 * Props on their way *into* the column.
 *
 * `JSON.parse(JSON.stringify(...))` rather than a spread: the value has to survive a
 * round trip through `jsonb` unchanged, and doing the round trip here means a props
 * object carrying something unserialisable fails at the enqueue site — inside the
 * caller's transaction, where it rolls back — instead of five seconds later in a
 * processor tick that has no way to tell the caller.
 */
export function toStoredPayload(props: unknown): Record<string, unknown> {
  const encoded: unknown = JSON.parse(JSON.stringify(props ?? {}));
  return encoded !== null && typeof encoded === 'object' && !Array.isArray(encoded)
    ? (encoded as Record<string, unknown>)
    : {};
}
