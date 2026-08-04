import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { RejectReason } from '@api/modules/shortlist/enums/reject-reason.enum';
import { Verdict } from '@api/modules/shortlist/enums/verdict.enum';

import { FIXED_NOW } from '../setup/time';

import { buildEntity, nextSequence, uuid } from './factory.support';

/**
 * `shortlist_items` (§4.20) — the single source of truth for a verdict.
 *
 * Verdicts are **not** stored on `tryon_results`. One row per `(userId, garmentId)`;
 * changing a verdict updates that same row. There is no second verdict column anywhere.
 *
 *  - `LOVE_IT` / `MAYBE` appear on the Shortlist screen, ordered by `rank`.
 *  - `NOT_FOR_ME` rows are kept for A-38 rejection analytics only: never on the shortlist,
 *    never counted toward the budget total, always excluded from enquiries. `rank` is null
 *    for them, which is what keeps them out of the ordered list by construction.
 */
export function buildShortlistItem(overrides: Partial<ShortlistItem> = {}): ShortlistItem {
  const sequence = nextSequence();

  return buildEntity<ShortlistItem>(
    ShortlistItem,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      userId: uuid(),
      garmentId: uuid(),
      verdict: Verdict.LOVE_IT,
      rank: sequence,
      rejectReason: null,
      note: null,
      latestResultId: uuid(),
      verdictAt: FIXED_NOW,
    },
    overrides,
  );
}

/** A "maybe" — shown on the shortlist alongside loves, ordered by the same `rank`. */
export function buildMaybeShortlistItem(overrides: Partial<ShortlistItem> = {}): ShortlistItem {
  return buildShortlistItem({ verdict: Verdict.MAYBE, ...overrides });
}

/**
 * A rejection (C-21). `rank` is null and a `rejectReason` is present — that pairing is what
 * A-38 aggregates.
 */
export function buildRejectedShortlistItem(
  rejectReason: RejectReason = RejectReason.TOO_HEAVY,
  overrides: Partial<ShortlistItem> = {},
): ShortlistItem {
  return buildShortlistItem({
    verdict: Verdict.NOT_FOR_ME,
    rank: null,
    rejectReason,
    ...overrides,
  });
}

/**
 * A ranked shortlist for one consumer — the C-32 drag-to-rank order, and the snapshot an
 * A-21 enquiry is built from.
 */
export function buildRankedShortlist(
  userId: string,
  garmentIds: readonly string[],
): ShortlistItem[] {
  return garmentIds.map((garmentId, index) =>
    buildShortlistItem({ userId, garmentId, rank: index + 1, verdict: Verdict.LOVE_IT }),
  );
}
