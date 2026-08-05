import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { BudgetBand } from '@api/modules/users/enums/budget-band.enum';
import { EventType } from '@api/modules/users/enums/event-type.enum';

import { EnquiryStatus } from '../enums/enquiry-status.enum';

/**
 * One snapshotted piece, as the **consumer** sees it in her own history (C-36).
 *
 * Everything descriptive comes from the `enquiry_items` snapshot columns (§4.24), not
 * from a join onto `garments`. That is what makes A-21 hold a year later: the enquiry
 * reads correctly even after the piece has been renamed, repriced, archived or
 * removed, because what she sent is what is stored.
 */
export class EnquiryItemResponseDto {
  @ApiProperty({ format: 'uuid', nullable: true, description: 'Null once the piece is gone.' })
  garmentId: string | null;

  @ApiProperty({ example: 'Zarrin Bridal Lehenga', description: 'Title at the time she sent it.' })
  title: string;

  @ApiProperty({ example: 'ZRN-0042' })
  sku: string;

  @ApiProperty({ nullable: true, example: 185_000, description: 'Price at the time she sent it.' })
  price: number | null;

  @ApiProperty({ example: 1, description: 'Her rank order at submission (A-21).' })
  rank: number;

  @ApiProperty({ nullable: true, description: 'Her per-item note at submission (A-21).' })
  note: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Signed, expiring URL for the render thumbnail (§3.4).',
  })
  renderThumbnailUrl: string | null;
}

/**
 * Her own enquiry — `GET /enquiries`, `GET /enquiries/:enquiryId` (C-36).
 *
 * **Internal notes are never on this DTO** (A-24). §4.25 asks for that to be "enforced
 * by a separate response DTO, not by a flag", and this is the separate DTO: there is
 * no field for a note to arrive in, so no future edit to a service can leak one by
 * forgetting to set a boolean. `lostReason` is absent for the same reason — the
 * studio's own reason for losing a sale is written for the studio.
 */
export class ConsumerEnquiryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENQ-2026-000137', description: 'Quote this and both sides find it.' })
  reference: string;

  @ApiProperty({ enum: EnquiryStatus })
  status: EnquiryStatus;

  @ApiProperty()
  message: string;

  @ApiProperty({ format: 'date', nullable: true })
  eventDate: Date | null;

  @ApiProperty({ enum: EventType, nullable: true })
  eventType: EventType | null;

  @ApiProperty({ enum: BudgetBand, nullable: true })
  budgetBand: BudgetBand | null;

  @ApiProperty({ nullable: true, example: 370_000, description: 'Total at the time she sent it.' })
  totalValue: number | null;

  @ApiProperty({ example: 3 })
  itemCount: number;

  @ApiProperty({ type: [EnquiryItemResponseDto] })
  items: EnquiryItemResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true })
  closedAt: Date | null;
}

/**
 * One snapshotted piece as an **admin** sees it (A-21).
 *
 * `renderUrl` is the full render, and `enquiry_items` is the **only** table that can
 * produce it. §4.24: "This table is the sole basis on which an admin may view a
 * render" (S-10). The URL is signed to the *requesting admin's* own id, so it works in
 * their session and in nobody else's, and it exists at all only because the consumer
 * chose to send this piece.
 */
export class AdminEnquiryItemDto extends EnquiryItemResponseDto {
  @ApiProperty({
    nullable: true,
    description:
      'Signed, expiring URL for the full render (§3.4), scoped to the requesting ' +
      'admin. Reachable only through this enquiry (S-10, §4.24).',
  })
  renderUrl: string | null;
}

/** A row of the A-25 inbox. */
export class AdminEnquirySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'ENQ-2026-000137' })
  reference: string;

  @ApiProperty({ enum: EnquiryStatus })
  status: EnquiryStatus;

  @ApiProperty({ example: 'Sana Mahmood' })
  contactName: string;

  @ApiProperty({ enum: EventType, nullable: true })
  eventType: EventType | null;

  @ApiProperty({ format: 'date', nullable: true })
  eventDate: Date | null;

  @ApiProperty({ enum: BudgetBand, nullable: true })
  budgetBand: BudgetBand | null;

  @ApiProperty({ example: 3 })
  itemCount: number;

  @ApiProperty({ nullable: true, example: 370_000 })
  totalValue: number | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  assignedTo: string | null;

  @ApiProperty({ description: 'Untouched for more than 24 hours (A-25). Derived, never stored.' })
  isStale: boolean;

  @ApiProperty({ nullable: true })
  firstRespondedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

/**
 * The full enquiry an admin works from — `GET /admin/enquiries/:enquiryId` (A-21).
 *
 * > A-21: "consumer name, verified contact details, event date, event type, budget
 * > band, shortlisted garments in her rank order with their renders, per-item notes,
 * > and her message."
 *
 * The contact fields are the **snapshot taken at submission**, not a join onto `users`
 * — an enquiry has to read correctly a year later even if she has since changed her
 * number or closed her account.
 *
 * Internal notes are not here either. They have their own route and their own DTO
 * (A-24), so a screen that renders an enquiry cannot accidentally render them beside
 * it, and the consumer DTO above cannot inherit them.
 */
export class AdminEnquiryResponseDto extends AdminEnquirySummaryDto {
  @ApiProperty({ format: 'uuid', description: 'The consumer who sent it.' })
  userId: string;

  @ApiProperty({ example: 'sana@example.com', description: 'Verified at submission (A-21).' })
  contactEmail: string;

  @ApiProperty({ example: '+923001234567', description: 'Verified by OTP before sending (C-3).' })
  contactPhone: string;

  @ApiProperty()
  message: string;

  @ApiPropertyOptional({ nullable: true, description: 'A-22. Set only on a lost enquiry.' })
  lostReason: string | null;

  @ApiProperty({ nullable: true })
  closedAt: Date | null;

  @ApiProperty({ type: [AdminEnquiryItemDto] })
  items: AdminEnquiryItemDto[];
}

/** An internal note — `GET`/`POST /admin/enquiries/:enquiryId/notes` (A-24). */
export class EnquiryNoteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  authorId: string | null;

  @ApiProperty({ nullable: true, example: 'Test Admin' })
  authorName: string | null;

  @ApiProperty()
  createdAt: Date;
}

/** The A-23 one-tap reply. */
export class WhatsAppReplyDto {
  @ApiProperty({
    example: 'https://wa.me/923001234567?text=…',
    description:
      'A wa.me deep link built from the **brand** number in Settings (A-27). An ' +
      'admin’s own number is never used and never returned.',
  })
  url: string;

  @ApiProperty({ description: 'The pre-filled message, so the UI can show it before opening.' })
  message: string;
}
