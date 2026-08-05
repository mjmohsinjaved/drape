import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import { MAX_ENQUIRY_NOTE_LENGTH, MAX_LOST_REASON_LENGTH } from '../constants/enquiry.constants';
import { EnquiryStatus } from '../enums/enquiry-status.enum';

/**
 * `PATCH /admin/enquiries/:enquiryId/status` — move status (A-22, §5.15).
 *
 * `lostReason` is required for `CLOSED_LOST` and refused with
 * `ENQUIRY_LOST_REASON_REQUIRED` when missing. The check lives in the state machine
 * rather than in a `@ValidateIf` here, so a caller cannot reach a status column
 * without passing it — validation states the shape, the machine states the rule.
 */
export class UpdateEnquiryStatusDto {
  @ApiProperty({ enum: EnquiryStatus })
  @IsEnum(EnquiryStatus)
  status: EnquiryStatus;

  @ApiPropertyOptional({
    maxLength: MAX_LOST_REASON_LENGTH,
    description: 'Required when closing as lost (A-22).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LOST_REASON_LENGTH)
  lostReason?: string;
}

/**
 * `PATCH /admin/enquiries/:enquiryId/assign` — assign to an admin (§5.15).
 *
 * `null` unassigns. The service refuses an id that is not an active admin: an enquiry
 * assigned to a consumer would be invisible in every admin filter, and one assigned to
 * a deactivated admin is a queue nobody is reading.
 */
export class AssignEnquiryDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'The admin to assign it to, or null to unassign.',
  })
  @IsOptional()
  @IsUUID()
  assignedTo!: string | null;
}

/**
 * `POST /admin/enquiries/:enquiryId/notes` — an internal note (A-24).
 *
 * Append-only (§4.25): there is no edit route and no delete route, here or anywhere.
 * Correcting a note means writing another one, which is the same rule every ledger in
 * the schema follows.
 */
export class CreateEnquiryNoteDto {
  @ApiProperty({ maxLength: MAX_ENQUIRY_NOTE_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_ENQUIRY_NOTE_LENGTH)
  body: string;
}
