import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

import { DeletionInitiator } from '../enums/deletion-initiator.enum';
import { DeletionSubject } from '../enums/deletion-subject.enum';

/**
 * `POST /me/export` and `GET /me/export/:exportId` — PRD C-39, ARCHITECTURE §5.2.
 *
 * ### Why there is no `PENDING` state in practice
 *
 * §5.2 asks for "export status, and the signed download URL when ready", which implies a
 * job. There is no job: her archive is her shortlists and her renders, C-5 caps her at
 * fifteen generations a month, and building it takes less time than a page load. `POST`
 * builds it and answers `READY`.
 *
 * The status field is still here and still honest, because `GET /me/export/:exportId`
 * has a real answer to give later: `EXPIRED`, once the archive has aged out of storage.
 * A consumer who bookmarks the link and comes back on Friday needs to be told that,
 * rather than shown a 404 that looks like her data went missing.
 */
export enum DataExportStatus {
  READY = 'READY',
  EXPIRED = 'EXPIRED',
}

/** `POST /me/export`, and the shape `GET /me/export/:exportId` returns. */
export class DataExportResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Also the filename inside her export prefix.' })
  exportId: string;

  @ApiProperty({ enum: DataExportStatus, enumName: 'DataExportStatus' })
  status: DataExportStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Signed, scoped to her own id (§3.4), and short-lived. Null once the archive has ' +
      'expired — a fresh `POST /me/export` produces another.',
  })
  downloadUrl: string | null;

  @ApiProperty({ example: 4_281_904, description: 'Archive size in bytes.' })
  byteSize: number;

  @ApiProperty({ example: 37, description: 'Renders in the archive.' })
  renderCount: number;

  @ApiProperty({ example: 12, description: 'Shortlist entries in the archive.' })
  shortlistCount: number;

  @ApiProperty({
    example: false,
    description:
      'True when the render count or total size hit its cap and the archive is partial. ' +
      'A `TRUNCATED.txt` inside says so too, so the fact travels with the file.',
  })
  truncated: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time', description: 'After this the archive is collected.' })
  expiresAt: Date;
}

/** The `:exportId` route parameter of `GET /me/export/:exportId`. */
export class ExportIdParamDto {
  @ApiProperty({ format: 'uuid', example: '8c6e5b7d-9f0a-4c23-9a1c-4e701f3b4a2d' })
  @IsUUID()
  exportId: string;
}

/**
 * `DELETE /me` (C-38) and `DELETE /admin/consumers/:userId` (A-20) both answer with this.
 *
 * It is the "confirmation record" A-20 asks for, and it is a **receipt for a request**,
 * not for a completed purge: `completedAt` is null until the sweep finishes, and `dueBy`
 * is the promise she is owed. Reporting a completion that has not happened would be the
 * one lie this whole module exists to avoid.
 */
export class DeletionReceiptResponseDto {
  @ApiProperty({ format: 'uuid', description: 'The `deletion_log` row (§4.31).' })
  deletionLogId: string;

  @ApiProperty({ enum: DeletionSubject, enumName: 'DeletionSubject' })
  subjectType: DeletionSubject;

  @ApiProperty({ format: 'uuid' })
  subjectId: string;

  @ApiProperty({ enum: DeletionInitiator, enumName: 'DeletionInitiator' })
  initiatedBy: DeletionInitiator;

  @ApiProperty({ format: 'date-time' })
  requestedAt: Date;

  @ApiProperty({
    format: 'date-time',
    description: '`DELETION_SLA_HOURS` after the request — the C-38 / A-20 promise.',
  })
  dueBy: Date;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Null until the purge has actually run. Never optimistic.',
  })
  completedAt: Date | null;
}
