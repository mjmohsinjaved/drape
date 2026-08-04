import { Enquiry } from '@api/modules/enquiries/entities/enquiry.entity';
import { EnquiryStatus } from '@api/modules/enquiries/enums/enquiry-status.enum';
import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';
import { EventType } from '@api/modules/users/enums/event-type.enum';

import { daysFromFixedNow, FIXED_NOW } from '../setup/time';

import { buildEntity, nextSequence, uuid } from './factory.support';

/**
 * `enquiries` (§4.23).
 *
 * The contact fields are a **snapshot taken at submission** (A-21), not a join onto `users`:
 * the enquiry has to read correctly a year later even if she has since changed her phone
 * number or deleted her account.
 *
 * Transitions: `NEW → CONTACTED → IN_DISCUSSION → CLOSED_WON | CLOSED_LOST`, plus
 * `NEW → CLOSED_LOST`. Anything else is `INVALID_ENQUIRY_TRANSITION`.
 */
export function buildEnquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  const sequence = nextSequence();

  return buildEntity<Enquiry>(
    Enquiry,
    {
      id: uuid(),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      deletedAt: null,

      // Shown to both sides, so it has to look like the real thing: ENQ-2026-000137.
      reference: `ENQ-${FIXED_NOW.getUTCFullYear()}-${`${sequence}`.padStart(6, '0')}`,
      userId: uuid(),
      message: 'I would like to see these in person. Which of them are available in my size?',
      status: EnquiryStatus.NEW,
      lostReason: null,

      eventDate: daysFromFixedNow(120),
      eventType: EventType.BARAAT,
      budgetBand: BudgetBand.BAND_250K_500K,

      contactName: `Test Consumer ${sequence}`,
      contactEmail: `consumer${sequence}@example.invalid`,
      // C-3 gates enquiry submission on a verified phone number.
      contactPhone: `+92300${`${sequence}`.padStart(7, '0')}`,

      // A-25 highlights an enquiry with no response after 24 hours.
      firstRespondedAt: null,
      closedAt: null,
      assignedTo: null,
      totalValueSnapshot: 370_000,
    },
    overrides,
  );
}

/** An enquiry an admin has replied to — no longer counted as stale by A-25. */
export function buildContactedEnquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  return buildEnquiry({
    status: EnquiryStatus.CONTACTED,
    firstRespondedAt: new Date(FIXED_NOW.getTime() + 3 * 60 * 60 * 1000),
    assignedTo: uuid(),
    ...overrides,
  });
}

/** A won enquiry. */
export function buildWonEnquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  return buildContactedEnquiry({
    status: EnquiryStatus.CLOSED_WON,
    closedAt: daysFromFixedNow(4),
    ...overrides,
  });
}

/** A lost enquiry. A-22 makes `lostReason` mandatory on `CLOSED_LOST`, so it is set here. */
export function buildLostEnquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  return buildContactedEnquiry({
    status: EnquiryStatus.CLOSED_LOST,
    lostReason: 'Chose a different studio.',
    closedAt: daysFromFixedNow(6),
    ...overrides,
  });
}

/** An enquiry that has gone unanswered past the A-25 24-hour highlight threshold. */
export function buildStaleEnquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  return buildEnquiry({ createdAt: daysFromFixedNow(-3), firstRespondedAt: null, ...overrides });
}
