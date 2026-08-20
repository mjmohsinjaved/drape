export const ROLES = ['ADMIN', 'CONSUMER'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const LOCALES = ['EN', 'UR'] as const;
export type Locale = (typeof LOCALES)[number];

export const EVENT_TYPES = [
  'MEHNDI',
  'NIKKAH',
  'BARAAT',
  'WALIMA',
  'ENGAGEMENT',
  'RECEPTION',
  'OTHER',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const BUDGET_BANDS = [
  'UNDER_100K',
  'BAND_100K_250K',
  'BAND_250K_500K',
  'BAND_500K_1M',
  'ABOVE_1M',
] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];

export const EMBELLISHMENT_WEIGHTS = ['LIGHT', 'MEDIUM', 'HEAVY'] as const;
export type EmbellishmentWeight = (typeof EMBELLISHMENT_WEIGHTS)[number];

export const GARMENT_MODES = ['SALE', 'RENTAL'] as const;
export type GarmentMode = (typeof GARMENT_MODES)[number];

export const PUBLISH_STATES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PublishState = (typeof PUBLISH_STATES)[number];

export const TEST_RENDER_STATES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type TestRenderState = (typeof TEST_RENDER_STATES)[number];

export const PHOTO_MODERATION_STATES = ['PENDING', 'APPROVED', 'BLOCKED'] as const;
export type PhotoModerationState = (typeof PHOTO_MODERATION_STATES)[number];

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_ORIGINS = ['CONSUMER', 'TEST_RENDER'] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];

export const VERDICTS = ['LOVE_IT', 'MAYBE', 'NOT_FOR_ME'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REJECT_REASONS = ['NECKLINE', 'COLOR', 'TOO_HEAVY', 'SILHOUETTE', 'PRICE'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REACTIONS = ['HEART', 'UNSURE', 'NO'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const ENQUIRY_STATUSES = [
  'NEW',
  'CONTACTED',
  'IN_DISCUSSION',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const QUOTA_REASONS = [
  'MONTHLY_GRANT',
  'OVERRIDE_GRANT',
  'GENERATION_CONSUMED',
  'ADMIN_ADJUSTMENT',
] as const;
export type QuotaReason = (typeof QUOTA_REASONS)[number];

export const USAGE_REASONS = [
  'MONTHLY_BUDGET_GRANT',
  'CONSUMER_GENERATION',
  'TEST_RENDER',
  'ADMIN_ADJUSTMENT',
] as const;
export type UsageReason = (typeof USAGE_REASONS)[number];

export const MODERATION_SOURCES = ['UPSTREAM', 'HEURISTIC', 'MANUAL_REPORT'] as const;
export type ModerationSource = (typeof MODERATION_SOURCES)[number];

export const MODERATION_STATES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'IN_APP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const VERIFICATION_PURPOSES = [
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'PHONE_OTP',
  'INVITE',
] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const AUTH_OUTCOMES = [
  'SUCCESS',
  'INVALID_CREDENTIALS',
  'LOCKED',
  'TWOFA_FAILED',
  'RATE_LIMITED',
  'SUSPENDED',
] as const;
export type AuthOutcome = (typeof AUTH_OUTCOMES)[number];

export const DELETION_SUBJECTS = [
  'USER',
  'PERSON_PHOTO',
  'TRYON_RESULT',
  'SHARE_LINK',
  'TRYON_JOB',
  'EXPORT_ARCHIVE',
] as const;
export type DeletionSubject = (typeof DELETION_SUBJECTS)[number];

export const DELETION_INITIATORS = ['CONSUMER', 'ADMIN', 'PURGE_JOB'] as const;
export type DeletionInitiator = (typeof DELETION_INITIATORS)[number];

export const SETTINGS_VALUE_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'JSON'] as const;
export type SettingsValueType = (typeof SETTINGS_VALUE_TYPES)[number];

export const CONSENT_STATUSES = ['GRANTED', 'REQUIRED', 'STALE'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const TRYON_STAGES = ['QUEUED', 'UPLOADING', 'GENERATING', 'FINISHING'] as const;
export type TryOnStage = (typeof TRYON_STAGES)[number];
