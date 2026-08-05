import { ApiProperty } from '@nestjs/swagger';

import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { DeletionInitiator } from '@api/modules/retention/enums/deletion-initiator.enum';
import { DeletionSubject } from '@api/modules/retention/enums/deletion-subject.enum';

/**
 * `DELETE /admin/consumers/:userId` (A-20, D-17).
 *
 * D-17 makes the admin type the account's name before an irreversible delete. That
 * confirmation is checked **server-side**: a confirmation the client alone enforces
 * is decoration, and this is the one operation in the console with no undo.
 */
export class DeleteConsumerDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 120,
    description: "The account's name, typed by the admin. Compared case- and space-insensitively.",
  })
  @Transform(({ value }): unknown => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  confirmName: string;
}

/**
 * The A-20 confirmation record.
 *
 * > "Delete a consumer and all associated photos, renders and shortlists. Completes
 * > within 24 hours with a confirmation record."
 *
 * The row is written here and **completed by the retention module**, which does the
 * actual purge, fills in `rowsDeleted`, `storageKeysDeleted`, `bytesReclaimed` and
 * the `verificationHash`, and stamps `completedAt` (§4.31, §9.3).
 */
export class DeletionReceiptResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The `deletion_log` row id.' })
  deletionLogId: string;

  @ApiProperty({ enum: DeletionSubject })
  subjectType: DeletionSubject;

  @ApiProperty({ format: 'uuid' })
  subjectId: string;

  @ApiProperty({ enum: DeletionInitiator })
  initiatedBy: DeletionInitiator;

  @ApiProperty({ format: 'date-time' })
  requestedAt: Date;

  @ApiProperty({
    format: 'date-time',
    description: 'The A-20 / C-38 deadline: `requestedAt` + `DELETION_SLA_HOURS`.',
  })
  dueBy: Date;

  @ApiProperty({ description: 'Live sessions revoked as part of the request.' })
  sessionsRevoked: number;
}
