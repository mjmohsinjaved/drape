import { In } from 'typeorm';

import { Verdict } from '../enums/verdict.enum';

import type { ShortlistItem } from '../entities/shortlist-item.entity';
import type { FindOptionsWhere } from 'typeorm';

/**
 * **What "on the shortlist" means — ARCHITECTURE §4.20, PRD C-20, C-32, A-38.**
 *
 * §4.20 pins the rule because it is otherwise ambiguous:
 *
 * > The **Shortlist** screen shows `LOVE_IT` and `MAYBE`, ordered by `rank`.
 * > `NOT_FOR_ME` rows are retained for A-38 rejection-reason analytics; they never
 * > appear on the shortlist, never count toward the budget total, and are excluded
 * > from enquiries.
 *
 * Three consumers of that rule — the shortlist screen, the share view and the enquiry
 * snapshot — must agree on it exactly. So it is written once, here, and the other two
 * modules import it rather than restating `verdict IN (…)` in their own query. A
 * rejection that leaked into a share link or an enquiry would be a piece she has
 * explicitly said no to, presented to her family or to the studio as one she wants.
 */

/** The verdicts that put a piece on the shortlist. `NOT_FOR_ME` is deliberately absent. */
export const SHORTLIST_VERDICTS: readonly Verdict[] = [Verdict.LOVE_IT, Verdict.MAYBE];

/** The same rule applied to a row that has already been loaded. */
export function isOnShortlist(item: ShortlistItem): boolean {
  return item.deletedAt === null && SHORTLIST_VERDICTS.includes(item.verdict);
}

/** Drops rejections and soft-deleted rows from a loaded set. */
export function onlyShortlisted(items: readonly ShortlistItem[]): ShortlistItem[] {
  return items.filter(isOnShortlist);
}

/**
 * The `where` clause for one consumer's shortlist.
 *
 * `userId` first, exactly as §2.9 rule 6 requires: "every list query is scoped by
 * `userId` for consumers before any other filter is applied".
 */
export function shortlistWhere(userId: string): FindOptionsWhere<ShortlistItem> {
  return { userId, verdict: In([...SHORTLIST_VERDICTS]) };
}

/**
 * The rank a verdict deserves.
 *
 * A rejection has no place in an ordering, so its rank is `null` — which is what
 * keeps `NOT_FOR_ME` out of the ordered list *by construction* rather than by a
 * filter somebody has to remember to write.
 */
export function rankForVerdict(verdict: Verdict, nextRank: number): number | null {
  return SHORTLIST_VERDICTS.includes(verdict) ? nextRank : null;
}

/** A reject reason only means anything beside a rejection (C-21). */
export function rejectReasonForVerdict<T>(verdict: Verdict, reason: T | null): T | null {
  return verdict === Verdict.NOT_FOR_ME ? reason : null;
}
