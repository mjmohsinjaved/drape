import { AppException, ErrorCode } from '@library/common';

import { EnquiryStatus } from '../enums/enquiry-status.enum';

import {
  assertEnquiryTransition,
  ENQUIRY_TRANSITIONS,
  isAllowedEnquiryTransition,
  isClosedEnquiryStatus,
} from './enquiry-status.machine';

/**
 * **A-22 / §4.23 — the status machine, exhaustively.**
 *
 * Every ordered pair of statuses is tried. That is twenty-five cases and it costs
 * nothing, and it means "every valid transition is allowed, every invalid one is
 * refused" is asserted rather than sampled: a future edit that quietly widens the
 * table fails here even if nobody thought to write a test for the edge it added.
 */
describe('The enquiry status machine (A-22, §4.23)', () => {
  const ALL = Object.values(EnquiryStatus);

  /** The five edges §4.23 grants, written out independently of the implementation. */
  const ALLOWED: ReadonlyArray<readonly [EnquiryStatus, EnquiryStatus]> = [
    [EnquiryStatus.NEW, EnquiryStatus.CONTACTED],
    [EnquiryStatus.NEW, EnquiryStatus.CLOSED_LOST],
    [EnquiryStatus.CONTACTED, EnquiryStatus.IN_DISCUSSION],
    [EnquiryStatus.IN_DISCUSSION, EnquiryStatus.CLOSED_WON],
    [EnquiryStatus.IN_DISCUSSION, EnquiryStatus.CLOSED_LOST],
  ];

  function isAllowedByContract(from: EnquiryStatus, to: EnquiryStatus): boolean {
    return ALLOWED.some(([left, right]) => left === from && right === to);
  }

  /** A reason, so the lost-close rule does not accidentally decide these cases. */
  const REASON = 'Chose a different studio.';

  describe('every valid transition is allowed', () => {
    it.each(ALLOWED)('%s → %s', (from, to) => {
      expect(isAllowedEnquiryTransition(from, to)).toBe(true);
      expect(() => assertEnquiryTransition(from, to, REASON)).not.toThrow();
    });
  });

  describe('every invalid transition is refused with INVALID_ENQUIRY_TRANSITION', () => {
    const invalid = ALL.flatMap((from) =>
      ALL.filter((to) => !isAllowedByContract(from, to)).map((to) => [from, to] as const),
    );

    it.each(invalid)('%s → %s', (from, to) => {
      expect(isAllowedEnquiryTransition(from, to)).toBe(false);

      try {
        assertEnquiryTransition(from, to, REASON);
        throw new Error(`${from} → ${to} was allowed and should not have been`);
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).errorCode).toBe(ErrorCode.INVALID_ENQUIRY_TRANSITION);
      }
    });
  });

  it('refuses a no-op move — re-sending the current status is not a transition', () => {
    for (const status of ALL) {
      expect(isAllowedEnquiryTransition(status, status)).toBe(false);
    }
  });

  describe('both closed states are terminal', () => {
    it.each([EnquiryStatus.CLOSED_WON, EnquiryStatus.CLOSED_LOST])('%s cannot move on', (from) => {
      expect(ENQUIRY_TRANSITIONS[from]).toEqual([]);
      expect(isClosedEnquiryStatus(from)).toBe(true);
    });

    it.each([EnquiryStatus.NEW, EnquiryStatus.CONTACTED, EnquiryStatus.IN_DISCUSSION])(
      '%s is not closed',
      (status) => {
        expect(isClosedEnquiryStatus(status)).toBe(false);
      },
    );
  });

  describe('a lost close requires a reason (A-22)', () => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['whitespace only', '   '],
    ])('refuses a %s reason', (_case, lostReason) => {
      try {
        assertEnquiryTransition(EnquiryStatus.NEW, EnquiryStatus.CLOSED_LOST, lostReason);
        throw new Error('A lost close without a reason was allowed');
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).errorCode).toBe(ErrorCode.ENQUIRY_LOST_REASON_REQUIRED);
      }
    });

    it('accepts a lost close that carries one', () => {
      expect(() =>
        assertEnquiryTransition(EnquiryStatus.NEW, EnquiryStatus.CLOSED_LOST, REASON),
      ).not.toThrow();
    });

    it('does not require a reason to close as won', () => {
      expect(() =>
        assertEnquiryTransition(EnquiryStatus.IN_DISCUSSION, EnquiryStatus.CLOSED_WON, null),
      ).not.toThrow();
    });
  });

  it('tells the admin which move was refused, and what is available instead', () => {
    try {
      assertEnquiryTransition(EnquiryStatus.NEW, EnquiryStatus.CLOSED_WON, null);
      throw new Error('NEW → CLOSED_WON was allowed');
    } catch (error) {
      const exception = error as AppException;
      expect(exception.getResponse()).toMatchObject({
        message: "An enquiry can't move from NEW to CLOSED_WON.",
      });
      expect(exception.details).toEqual({
        from: EnquiryStatus.NEW,
        to: EnquiryStatus.CLOSED_WON,
        allowed: [EnquiryStatus.CONTACTED, EnquiryStatus.CLOSED_LOST],
      });
    }
  });
});
