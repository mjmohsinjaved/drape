import { buildEntity, nextSequence, uuid } from '../../../../test/factories';
import { FIXED_NOW } from '../../../../test/setup/time';
import { EnquiryItem } from '../entities/enquiry-item.entity';
import { EnquiryNote } from '../entities/enquiry-note.entity';

/**
 * Fixtures for `enquiry_items` and `enquiry_notes` (§4.24, §4.25).
 *
 * They live in the module rather than in `test/factories` because they encode rules
 * this module owns: an item is a **snapshot**, so every snapshot column is populated
 * even when the foreign key is present — a fixture with a `garmentId` and an empty
 * `garmentTitleSnapshot` would let a broken A-21 projection pass by joining `garments`
 * for its text, which is exactly what §4.24 forbids.
 */

/** One snapshotted piece, complete enough that the admin view never needs a join. */
export function buildEnquiryItem(overrides: Partial<EnquiryItem> = {}): EnquiryItem {
  const sequence = nextSequence();

  return buildEntity<EnquiryItem>(
    EnquiryItem,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      enquiryId: uuid(),
      garmentId: uuid(),
      // The render an admin may see, and the only basis on which they may (S-10).
      resultId: uuid(),
      rank: sequence,
      note: null,
      garmentTitleSnapshot: `Test Garment ${sequence}`,
      garmentSkuSnapshot: `TEST-SKU-${`${sequence}`.padStart(5, '0')}`,
      garmentPriceSnapshot: 185_000,
    },
    overrides,
  );
}

/**
 * An internal note (A-24) — append-only, so `AppendOnlyEntity` gives it a `createdAt`
 * and deliberately no `updatedAt` and no `deletedAt`.
 */
export function buildEnquiryNote(overrides: Partial<EnquiryNote> = {}): EnquiryNote {
  return buildEntity<EnquiryNote>(
    EnquiryNote,
    {
      id: uuid(),
      createdAt: FIXED_NOW,

      enquiryId: uuid(),
      authorId: uuid(),
      body: 'Called and left a message.',
    },
    overrides,
  );
}
