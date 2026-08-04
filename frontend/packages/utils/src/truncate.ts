/**
 * Text truncation.
 *
 * Length is counted in Unicode code points, not UTF-16 units, so an Urdu or emoji-bearing
 * garment title is never cut through the middle of a character.
 */

export interface TruncateOptions {
  /** Appended when the text is shortened. Defaults to a single-character ellipsis. */
  ellipsis?: string;
  /**
   * Cut at the last whitespace before the limit instead of mid-word.
   * Falls back to a hard cut when there is no whitespace to break on.
   */
  wordBoundary?: boolean;
}

const DEFAULT_ELLIPSIS = '…';

/**
 * Shortens `input` to at most `maxLength` code points **including** the ellipsis.
 *
 * @example truncate('Zarrin Bridal Lehenga', 12)                        // "Zarrin Brid…"
 * @example truncate('Zarrin Bridal Lehenga', 12, { wordBoundary: true }) // "Zarrin…"
 */
export function truncate(
  input: string | null | undefined,
  maxLength: number,
  options: TruncateOptions = {},
): string {
  const { ellipsis = DEFAULT_ELLIPSIS, wordBoundary = false } = options;

  if (typeof input !== 'string' || input === '') {
    return '';
  }

  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return '';
  }

  const characters = Array.from(input);
  if (characters.length <= maxLength) {
    return input;
  }

  const ellipsisLength = Array.from(ellipsis).length;

  // No room for content alongside the ellipsis — return a hard cut of the input itself.
  if (ellipsisLength >= maxLength) {
    return characters.slice(0, maxLength).join('');
  }

  const keep = maxLength - ellipsisLength;
  let head = characters.slice(0, keep).join('');

  if (wordBoundary) {
    const lastSpace = head.search(/\s+\S*$/u);
    if (lastSpace > 0) {
      head = head.slice(0, lastSpace);
    }
  }

  return `${head.replace(/\s+$/u, '')}${ellipsis}`;
}
