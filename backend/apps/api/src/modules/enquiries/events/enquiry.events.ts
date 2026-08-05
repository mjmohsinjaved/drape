import type { EnquiryStatus } from '../enums/enquiry-status.enum';

/**
 * Domain events this module emits — named `domain.action` per §2.2.
 *
 * Both are emitted **after** the transaction commits. A listener that fires on a
 * transaction which later rolls back has told the world a lie, and here that lie would
 * be an email to a consumer about an enquiry the studio never received.
 */

/** A consumer submitted an enquiry (C-35). Drives the A-25 notifications. */
export const ENQUIRY_CREATED_EVENT = 'enquiry.created';

/** An admin moved an enquiry's status (A-22). */
export const ENQUIRY_STATUS_CHANGED_EVENT = 'enquiry.status-changed';

/**
 * What the A-25 notifications need.
 *
 * No email address and no phone number: the listener resolves the consumer from
 * `userId` and the admins from their role. An address on an event payload is an
 * address in a log line (E-12).
 */
export interface EnquiryCreatedInput {
  readonly enquiryId: string;
  readonly reference: string;
  readonly userId: string;
  readonly itemCount: number;
  /** Titles in her rank order, for the admin email and her confirmation. */
  readonly garmentTitles: readonly string[];
  readonly submittedAt: Date;
}

/** The typed envelope carried by {@link ENQUIRY_CREATED_EVENT}. */
export class EnquiryCreatedEvent {
  constructor(readonly input: EnquiryCreatedInput) {}
}

/**
 * A status move.
 *
 * `lostReason` is deliberately absent. A-22's reason is the studio's own bookkeeping;
 * the consumer-facing status email carries a `studioNote` that is explicitly "never an
 * internal admin note", so there is nothing here for one to leak through.
 */
export interface EnquiryStatusChangedInput {
  readonly enquiryId: string;
  readonly reference: string;
  readonly userId: string;
  readonly from: EnquiryStatus;
  readonly to: EnquiryStatus;
  readonly changedAt: Date;
}

/** The typed envelope carried by {@link ENQUIRY_STATUS_CHANGED_EVENT}. */
export class EnquiryStatusChangedEvent {
  constructor(readonly input: EnquiryStatusChangedInput) {}
}
