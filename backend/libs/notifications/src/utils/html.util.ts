/**
 * Escaping helpers for the hand-written email layout.
 *
 * There is no template engine, so escaping is explicit and lives here. Every value that reaches the
 * HTML body goes through `escapeHtml`; every value that reaches an attribute goes through
 * `escapeAttribute`.
 */

/**
 * Escapes for a text node. The apostrophe is deliberately left alone so that mandated copy — for
 * example PRD §8.3's "Our fitting room is at capacity today — we'll email you when it's back." —
 * survives verbatim in the HTML body. Attributes are always double-quoted, so this is safe.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escapes for a double-quoted attribute value. Stricter: the apostrophe goes too. */
export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#x27;');
}

/**
 * Returns the URL only when it is an absolute `http`/`https` URL. Anything else — `javascript:`,
 * `data:`, a relative path — yields null and the caller renders plain text instead.
 */
export function safeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Joins a base URL and a path without doubling or dropping the separator. */
export function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return trimmedPath.length === 0 ? trimmedBase : `${trimmedBase}/${trimmedPath}`;
}

/** Collapses runs of blank lines so the plain-text alternative reads cleanly. */
export function tidyText(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
