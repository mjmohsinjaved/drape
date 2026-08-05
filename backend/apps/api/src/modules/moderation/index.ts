/**
 * The `moderation` module's public surface — ARCHITECTURE §4.29, §5.17.
 *
 * One export, deliberately: `ModerationQueueService`, and of its methods only
 * `pendingSummary()` and `countOverdue()` are of any use outside this module. They feed
 * the A-1 landing tile ("items flagged for review") that `analytics` assembles.
 *
 * **The decision verbs are not part of any other module's vocabulary.** Approving a
 * consumer's photograph is an admin act behind an audited, `@Roles(Role.ADMIN)` route;
 * a second caller reaching `approve()` from elsewhere would be an unaudited decision,
 * which is precisely what A-34 and §9.3 forbid.
 *
 * `MODERATION_PHOTO_COLUMNS` is exported so a reviewer can see, in one place, the exact
 * list of `person_photos` columns this module is permitted to load — and confirm that
 * `storageKey` is not among them (S-10).
 */
export { ModerationModule } from './moderation.module';

export { ModerationQueueService } from './services/moderation-queue.service';
export { AbuseService, FAILED_OUTCOMES, type AuthAnomalySignal } from './services/abuse.service';
export {
  ModerationMonitorService,
  isAnomalous,
  type SweepReport,
} from './services/moderation-monitor.service';

export { ModerationItem } from './entities/moderation-item.entity';
export { IpBlock } from './entities/ip-block.entity';
export { ModerationSource } from './enums/moderation-source.enum';
export { ModerationState } from './enums/moderation-state.enum';

export { ModerationItemResponseDto } from './dto/moderation-item-response.dto';
export {
  MODERATION_SORT_KEYS,
  ModerationItemParamDto,
  ModerationQueryDto,
  type ModerationSortKey,
} from './dto/moderation-query.dto';
export { ReviewModerationItemDto } from './dto/review-moderation.dto';
export {
  AbuseOverviewResponseDto,
  AbuseQueryDto,
  AbusiveAccountResponseDto,
  CIDR_PATTERN,
  CreateIpBlockDto,
  IpBlockParamDto,
  IpBlockResponseDto,
} from './dto/abuse.dto';

export {
  ABUSE_MIN_FAILURES,
  ABUSE_PAGE_LIMIT,
  ABUSE_WINDOW_HOURS,
  ABUSE_WINDOW_MINUTES,
  AUTH_ANOMALY_FAILURE_THRESHOLD,
  AUTH_ANOMALY_SPREAD_THRESHOLD,
  MAX_DECISION_NOTE_LENGTH,
  MAX_IP_BLOCK_REASON_LENGTH,
  MODERATION_BACKLOG_MIN_OVERDUE,
  MODERATION_BACKLOG_THRESHOLD_HOURS,
  MODERATION_PHOTO_COLUMNS,
  MODERATION_SWEEP_MS,
} from './constants/moderation.constants';

export {
  toIpBlockResponse,
  toModerationItemResponse,
  type ModerationPhotoFacts,
  type SignBlurredThumbnail,
} from './mappers/moderation.mapper';
