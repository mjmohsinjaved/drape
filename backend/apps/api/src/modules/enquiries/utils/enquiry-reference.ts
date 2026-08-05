import { currentPeriod } from '@library/common';

import {
  ENQUIRY_REFERENCE_PREFIX,
  ENQUIRY_REFERENCE_SEQUENCE_WIDTH,
} from '../constants/enquiry.constants';

/**
 * `ENQ-2026-000137` — the reference both sides quote (§4.23).
 *
 * It is shown to a consumer in her confirmation email and read back to her over the
 * phone by an admin, so it has to be short, unambiguous when spoken, and obviously not
 * a database id. A uuid is none of those things, which is why this column exists
 * alongside one.
 *
 * The year comes from `currentPeriod()`, so it is the year in `Asia/Karachi` — the same
 * timezone the quota and budget ledgers use. An enquiry sent at 2 a.m. on 1 January in
 * Lahore belongs to the new year in the studio's books, not to the old one in UTC.
 *
 * The sequence is per year and derived by counting, which is safe because it is
 * derived and applied **inside the enquiry's own transaction** and backed by
 * `UQ_enquiries_reference`: two submissions racing for `000137` produce one commit and
 * one unique violation, and the loser retries onto `000138`. A dedicated sequence
 * object would avoid the retry, at the cost of a second schema object that has to be
 * kept in step with a partial unique index. For a studio's enquiry volume, the retry
 * is cheaper than the coupling.
 */
export function enquiryReferenceYear(now: Date = new Date()): string {
  return currentPeriod(undefined, now).slice(0, 4);
}

/** Formats one reference from a year and a 1-based sequence. */
export function formatEnquiryReference(year: string, sequence: number): string {
  const padded = `${sequence}`.padStart(ENQUIRY_REFERENCE_SEQUENCE_WIDTH, '0');
  return `${ENQUIRY_REFERENCE_PREFIX}-${year}-${padded}`;
}

/** The prefix every reference from one year shares — what a count is scoped by. */
export function enquiryReferencePrefixFor(year: string): string {
  return `${ENQUIRY_REFERENCE_PREFIX}-${year}-`;
}
