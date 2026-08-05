/**
 * The `retention` module's public surface — ARCHITECTURE §4.31, §9.3.
 *
 * **No service is exported, deliberately.** Deletion is requested through one of two
 * routes — `DELETE /me` (C-38) here, or `DELETE /admin/consumers/:userId` (A-20) in
 * `users`, which writes the `deletion_log` request row this module executes. A service
 * exported from here would be a third way to delete an account, and the one that skipped
 * the log row; that row is the entirety of what §9.3 calls "a verifiable deletion log".
 *
 * What is exported is the machinery a reviewer or another workstream needs to *read*:
 * the entity and its enums, the response shapes, and the ZIP writer — which is a real
 * ZIP implementation rather than a dependency, and is worth being able to test and reuse
 * on its own.
 */
export { RetentionModule } from './retention.module';

export { DeletionLogEntry } from './entities/deletion-log-entry.entity';
export { DeletionInitiator } from './enums/deletion-initiator.enum';
export { DeletionSubject } from './enums/deletion-subject.enum';

export {
  DataExportResponseDto,
  DataExportStatus,
  DeletionReceiptResponseDto,
  ExportIdParamDto,
} from './dto/data-export-response.dto';
export {
  MyDataConsentDto,
  MyDataEnquiryDto,
  MyDataPhotoDto,
  MyDataProfileDto,
  MyDataRenderDto,
  MyDataResponseDto,
  MyDataSectionDto,
  MyDataShareLinkDto,
  MyDataShortlistItemDto,
} from './dto/my-data-response.dto';

export {
  buildZipArchive,
  crc32,
  normaliseEntryName,
  toDosDateTime,
  type ZipEntry,
} from './utils/zip-archive';
// The export key builder used to live in `./utils/export-key.builder.ts`, flagged in its
// own comment for the move it has now had: §3.3 says keys are built **only** by
// `storage-key.builder.ts`, and `exports/**` is in that file's vocabulary now —
// `StorageKeys.dataExport`, `StorageKeys.dataExportFor`, `StoragePrefixes.exportsOfUser`,
// `exportIdFromKey`, `EXPORT_CONTENT_TYPE` and `EXPORT_EXTENSION`, all from
// `@library/storage`. The §3.4 issuing table gained the row that went with it: `exports/**`
// requires a `sub` and takes the render TTL, because an archive is a container full of
// renders.

export { type PurgeReport } from './services/purge.service';
export { type NamespaceSweepReport, type OrphanSweepReport } from './services/orphan-sweep.service';
// The policy — a date calculator, not a way to delete anything. See `retention-policy.module.ts`.
export { RetentionPolicyModule } from './retention-policy.module';
export {
  purgeDateFor,
  RetentionPolicy,
  retentionAnchorOf,
  type RetentionAnchor,
} from './services/retention-policy.service';
export { overdueBefore, type AccountPurgeResult } from './services/account-deletion.service';
export {
  DELETION_JOB_NAME,
  ORPHAN_SWEEP_JOB_NAME,
  PURGE_JOB_NAME,
  RetentionProcessor,
} from './processors/retention.processor';
export { RenderDeletedListener } from './listeners/render-deleted.listener';

export {
  DEFAULT_DELETION_SLA_HOURS,
  DEFAULT_PHOTO_RETENTION_DAYS,
  DELETION_BATCH_SIZE,
  DELETION_SLA_WARNING_FRACTION,
  DELETION_SWEEP_MS,
  EXPORT_RETENTION_HOURS,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_RENDERS,
  MAX_LIVE_EXPORTS_PER_CONSUMER,
  MY_DATA_PAGE_SIZE,
  ORPHAN_MIN_AGE_HOURS,
  ORPHAN_SWEEP_CRON,
  ORPHAN_SWEEP_DELETE_LIMIT,
  ORPHAN_SWEEP_LIST_LIMIT,
  PURGE_BATCH_SIZE,
  PURGE_CRON,
  TEMP_SWEEP_LIMIT,
} from './constants/retention.constants';
