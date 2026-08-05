import { ConflictException, ErrorCode, ValidationException } from '@library/common';

import { EnquiryStatus } from '../enums/enquiry-status.enum';

/**
 * **The enquiry status machine — PRD A-22, ARCHITECTURE §4.23.**
 *
 * > §4.23: "Transitions: `NEW → CONTACTED → IN_DISCUSSION → CLOSED_WON | CLOSED_LOST`;
 * > `NEW → CLOSED_LOST` is allowed. Anything else is `INVALID_ENQUIRY_TRANSITION`."
 *
 * Read literally, that grants five edges and no others:
 *
 * | From | To |
 * | --- | --- |
 * | `NEW` | `CONTACTED`, `CLOSED_LOST` |
 * | `CONTACTED` | `IN_DISCUSSION` |
 * | `IN_DISCUSSION` | `CLOSED_WON`, `CLOSED_LOST` |
 * | `CLOSED_WON` | — terminal |
 * | `CLOSED_LOST` | — terminal |
 *
 * The literal reading is what is implemented, because CLAUDE.md makes ARCHITECTURE.md
 * authoritative: "if code and this file disagree, the file is right and the code is a
 * defect". Two consequences are worth naming so nobody has to rediscover them:
 * `CONTACTED → CLOSED_LOST` is refused (an admin who has made contact and been turned
 * down moves through `IN_DISCUSSION` first), and neither closed state reopens. If the
 * studio decides the first of those is wrong in practice, it is one row of this table
 * — but it is a change to the contract, not to the code, and it belongs in
 * ARCHITECTURE.md first.
 *
 * Both closed states are terminal by construction rather than by a `closedAt` check
 * elsewhere, so "can this enquiry still move?" has exactly one answer and it is here.
 */
export const ENQUIRY_TRANSITIONS: Readonly<Record<EnquiryStatus, readonly EnquiryStatus[]>> = {
  [EnquiryStatus.NEW]: [EnquiryStatus.CONTACTED, EnquiryStatus.CLOSED_LOST],
  [EnquiryStatus.CONTACTED]: [EnquiryStatus.IN_DISCUSSION],
  [EnquiryStatus.IN_DISCUSSION]: [EnquiryStatus.CLOSED_WON, EnquiryStatus.CLOSED_LOST],
  [EnquiryStatus.CLOSED_WON]: [],
  [EnquiryStatus.CLOSED_LOST]: [],
};

/** The two states an enquiry never leaves. */
export const CLOSED_ENQUIRY_STATUSES: readonly EnquiryStatus[] = [
  EnquiryStatus.CLOSED_WON,
  EnquiryStatus.CLOSED_LOST,
];

/** true once the enquiry is closed — which is what sets `closedAt` (§4.23). */
export function isClosedEnquiryStatus(status: EnquiryStatus): boolean {
  return CLOSED_ENQUIRY_STATUSES.includes(status);
}

/** Whether one status may move to another. A no-op move (`from === to`) is not a transition. */
export function isAllowedEnquiryTransition(from: EnquiryStatus, to: EnquiryStatus): boolean {
  return ENQUIRY_TRANSITIONS[from].includes(to);
}

/**
 * Refuses an invalid move, and a `CLOSED_LOST` without a reason.
 *
 * A-22 makes the reason mandatory on lost, and mandatory means checked here rather
 * than at the call site: this function is the only thing between an admin's request
 * and a status column, so a rule enforced anywhere else is a rule the next caller can
 * skip. A blank string is not a reason — "why did we lose it?" is the question A-38's
 * sibling analysis is built on, and `'   '` answers nothing.
 *
 * The `{from}` / `{to}` interpolation matches the §2.4 message template for
 * `INVALID_ENQUIRY_TRANSITION`, so the admin is told which move was refused rather
 * than that something was.
 */
export function assertEnquiryTransition(
  from: EnquiryStatus,
  to: EnquiryStatus,
  lostReason: string | null | undefined,
): void {
  if (!isAllowedEnquiryTransition(from, to)) {
    throw new ConflictException(ErrorCode.INVALID_ENQUIRY_TRANSITION, {
      message: `An enquiry can't move from ${from} to ${to}.`,
      details: { from, to, allowed: [...ENQUIRY_TRANSITIONS[from]] },
    });
  }

  if (to === EnquiryStatus.CLOSED_LOST && (lostReason ?? '').trim().length === 0) {
    throw new ValidationException(ErrorCode.ENQUIRY_LOST_REASON_REQUIRED, {
      errors: [
        {
          field: 'lostReason',
          message: 'Add a reason before closing this as lost.',
          code: 'REQUIRED',
        },
      ],
    });
  }
}
