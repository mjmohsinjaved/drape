import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drape — initial schema.
 *
 * Hand-written from ARCHITECTURE §4.1 through §4.33, column for column. Nothing here
 * is generated: `synchronize` is `false` in every environment, and this file is the
 * reviewable record of what the database actually looks like.
 *
 * `up()` runs in four passes so ordering never depends on table order:
 *   1. extensions and every PostgreSQL enum type (§4.1)
 *   2. every table, with primary keys but **no** foreign keys (§4.3 – §4.32)
 *   3. every index, including the partial and expression indexes
 *   4. every foreign key, then the append-only rules (§2.1)
 *
 * `down()` reverses all four exactly, in the opposite order.
 *
 * Two invariants worth restating, because they are load-bearing:
 * - **Every unique index on a soft-deletable table carries `WHERE "deletedAt" IS NULL`**
 *   (§4.0 rule 4). The append-only tables have no `deletedAt`; their two unique
 *   indexes (`UQ_quota_ledger_job`, `UQ_usage_ledger_job`) therefore carry no such
 *   predicate, and that is deliberate.
 * - **`quota_ledger` and `usage_ledger` have no stored balance column** (§4.0 rule
 *   10). Remaining quota and remaining budget are derived with `SUM(delta)`.
 *   `usage_ledger.balanceAfter` is an advisory snapshot for the A-33 chart and is
 *   never read to make a decision.
 */
export class InitialSchema1754000000000 implements MigrationInterface {
  name = 'InitialSchema1754000000000';

  /* ======================================================================== */
  /* 1. Extensions and enum types (§4.1)                                      */
  /* ======================================================================== */

  private readonly extensions: string[] = [
    // `uuid_generate_v4()` is what TypeORM's postgres driver expects for
    // @PrimaryGeneratedColumn('uuid'); pg_trgm backs the C-17 title search.
    `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
    `CREATE EXTENSION IF NOT EXISTS "pg_trgm"`,
  ];

  private readonly enumTypes: string[] = [
    `CREATE TYPE "role_enum" AS ENUM ('ADMIN', 'CONSUMER')`,
    `CREATE TYPE "user_status_enum" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')`,
    `CREATE TYPE "locale_enum" AS ENUM ('EN', 'UR')`,
    `CREATE TYPE "event_type_enum" AS ENUM ('MEHNDI', 'NIKKAH', 'BARAAT', 'WALIMA', 'ENGAGEMENT', 'RECEPTION', 'OTHER')`,
    `CREATE TYPE "budget_band_enum" AS ENUM ('UNDER_100K', 'BAND_100K_250K', 'BAND_250K_500K', 'BAND_500K_1M', 'ABOVE_1M')`,
    `CREATE TYPE "embellishment_weight_enum" AS ENUM ('LIGHT', 'MEDIUM', 'HEAVY')`,
    `CREATE TYPE "garment_mode_enum" AS ENUM ('SALE', 'RENTAL')`,
    `CREATE TYPE "publish_state_enum" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED')`,
    `CREATE TYPE "test_render_state_enum" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED')`,
    `CREATE TYPE "photo_moderation_state_enum" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED')`,
    `CREATE TYPE "job_status_enum" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`,
    `CREATE TYPE "job_origin_enum" AS ENUM ('CONSUMER', 'TEST_RENDER')`,
    `CREATE TYPE "verdict_enum" AS ENUM ('LOVE_IT', 'MAYBE', 'NOT_FOR_ME')`,
    `CREATE TYPE "reject_reason_enum" AS ENUM ('NECKLINE', 'COLOR', 'TOO_HEAVY', 'SILHOUETTE', 'PRICE')`,
    `CREATE TYPE "reaction_enum" AS ENUM ('HEART', 'UNSURE', 'NO')`,
    `CREATE TYPE "enquiry_status_enum" AS ENUM ('NEW', 'CONTACTED', 'IN_DISCUSSION', 'CLOSED_WON', 'CLOSED_LOST')`,
    `CREATE TYPE "quota_reason_enum" AS ENUM ('MONTHLY_GRANT', 'OVERRIDE_GRANT', 'GENERATION_CONSUMED', 'ADMIN_ADJUSTMENT')`,
    `CREATE TYPE "usage_reason_enum" AS ENUM ('MONTHLY_BUDGET_GRANT', 'CONSUMER_GENERATION', 'TEST_RENDER', 'ADMIN_ADJUSTMENT')`,
    `CREATE TYPE "moderation_source_enum" AS ENUM ('UPSTREAM', 'HEURISTIC', 'MANUAL_REPORT')`,
    `CREATE TYPE "moderation_state_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED')`,
    `CREATE TYPE "notification_channel_enum" AS ENUM ('EMAIL', 'SMS', 'IN_APP')`,
    `CREATE TYPE "notification_status_enum" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')`,
    `CREATE TYPE "verification_purpose_enum" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'PHONE_OTP', 'INVITE')`,
    `CREATE TYPE "auth_outcome_enum" AS ENUM ('SUCCESS', 'INVALID_CREDENTIALS', 'LOCKED', 'TWOFA_FAILED', 'RATE_LIMITED', 'SUSPENDED')`,
    `CREATE TYPE "deletion_subject_enum" AS ENUM ('USER', 'PERSON_PHOTO', 'TRYON_RESULT', 'SHARE_LINK', 'TRYON_JOB', 'EXPORT_ARCHIVE')`,
    `CREATE TYPE "deletion_initiator_enum" AS ENUM ('CONSUMER', 'ADMIN', 'PURGE_JOB')`,
    `CREATE TYPE "settings_value_type_enum" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON')`,
  ];

  /** Reverse of `enumTypes`. */
  private readonly enumTypeNames: string[] = [
    'role_enum',
    'user_status_enum',
    'locale_enum',
    'event_type_enum',
    'budget_band_enum',
    'embellishment_weight_enum',
    'garment_mode_enum',
    'publish_state_enum',
    'test_render_state_enum',
    'photo_moderation_state_enum',
    'job_status_enum',
    'job_origin_enum',
    'verdict_enum',
    'reject_reason_enum',
    'reaction_enum',
    'enquiry_status_enum',
    'quota_reason_enum',
    'usage_reason_enum',
    'moderation_source_enum',
    'moderation_state_enum',
    'notification_channel_enum',
    'notification_status_enum',
    'verification_purpose_enum',
    'auth_outcome_enum',
    'deletion_subject_enum',
    'deletion_initiator_enum',
    'settings_value_type_enum',
  ];

  /* ======================================================================== */
  /* 2. Tables (§4.3 – §4.32)                                                 */
  /* ======================================================================== */

  /**
   * `BaseEntity` supplies `id`, `createdAt`, `updatedAt`, `deletedAt`.
   * `AppendOnlyEntity` supplies `id` and `createdAt` only — no `updatedAt`, no
   * `deletedAt`, by design (§2.1).
   */
  private readonly tables: string[] = [
    // ---------------------------------------------------------------- §4.3
    `CREATE TABLE "users" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "role" "role_enum" NOT NULL,
      "email" varchar(320) NOT NULL,
      "emailVerifiedAt" timestamptz,
      "passwordHash" varchar(255) NOT NULL,
      "name" varchar(120) NOT NULL,
      "phone" varchar(24),
      "phoneVerifiedAt" timestamptz,
      "twofaSecret" varchar(255),
      "twofaEnabledAt" timestamptz,
      "twofaRecoveryCodes" text[],
      "status" "user_status_enum" NOT NULL DEFAULT 'ACTIVE',
      "suspendedReason" text,
      "suspendedAt" timestamptz,
      "invitedBy" uuid,
      "lastLoginAt" timestamptz,
      "lastActiveAt" timestamptz,
      "failedLoginCount" integer NOT NULL DEFAULT 0,
      "lockedUntil" timestamptz,
      "locale" "locale_enum" NOT NULL DEFAULT 'EN',
      "deletionRequestedAt" timestamptz,
      CONSTRAINT "PK_users" PRIMARY KEY ("id")
    )`,

    // ---------------------------------------------------------------- §4.4
    `CREATE TABLE "consumer_profiles" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid NOT NULL,
      "eventDate" date,
      "eventType" "event_type_enum",
      "budgetBand" "budget_band_enum",
      "preferredCategories" uuid[] NOT NULL DEFAULT '{}',
      "monthlyQuotaOverride" integer,
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}',
      "onboardingCompletedAt" timestamptz,
      CONSTRAINT "PK_consumer_profiles" PRIMARY KEY ("id")
    )`,

    // ---------------------------------------------------------------- §4.5
    `CREATE TABLE "sessions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid NOT NULL,
      "tokenHash" char(64) NOT NULL,
      "csrfSecret" char(64) NOT NULL,
      "role" "role_enum" NOT NULL,
      "ip" inet NOT NULL,
      "userAgent" varchar(512),
      "lastSeenAt" timestamptz NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "absoluteExpiresAt" timestamptz NOT NULL,
      "twofaPending" boolean NOT NULL DEFAULT false,
      "twofaVerifiedAt" timestamptz,
      "revokedAt" timestamptz,
      "revokedReason" varchar(64),
      CONSTRAINT "PK_sessions" PRIMARY KEY ("id")
    )`,

    // ---------------------------------------------------------------- §4.6
    `CREATE TABLE "verification_tokens" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid,
      "purpose" "verification_purpose_enum" NOT NULL,
      "tokenHash" char(64) NOT NULL,
      "codeHash" char(64),
      "destination" varchar(320) NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz,
      "attempts" integer NOT NULL DEFAULT 0,
      "ip" inet,
      CONSTRAINT "PK_verification_tokens" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------- §4.7 · append-only
    `CREATE TABLE "auth_attempts" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "emailHash" char(64) NOT NULL,
      "userId" uuid,
      "ip" inet NOT NULL,
      "userAgent" varchar(512),
      "outcome" "auth_outcome_enum" NOT NULL,
      "route" varchar(64) NOT NULL,
      CONSTRAINT "PK_auth_attempts" PRIMARY KEY ("id")
    )`,

    // ---------------------------------------------------------------- §4.8
    `CREATE TABLE "ip_blocks" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "cidr" cidr NOT NULL,
      "reason" varchar(255) NOT NULL,
      "createdBy" uuid,
      "expiresAt" timestamptz,
      CONSTRAINT "PK_ip_blocks" PRIMARY KEY ("id")
    )`,

    // ---------------------------------------------------------------- §4.9
    `CREATE TABLE "invites" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "email" varchar(320) NOT NULL,
      "role" "role_enum" NOT NULL,
      "tokenHash" char(64) NOT NULL,
      "expiresAt" timestamptz NOT NULL,
      "consumedAt" timestamptz,
      "invitedBy" uuid NOT NULL,
      "consumedByUserId" uuid,
      CONSTRAINT "PK_invites" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.10
    `CREATE TABLE "policy_versions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "version" varchar(20) NOT NULL,
      "effectiveFrom" timestamptz NOT NULL,
      "isCurrent" boolean NOT NULL DEFAULT false,
      "bodyEn" text NOT NULL,
      "bodyUr" text NOT NULL,
      "summaryEn" text NOT NULL,
      "summaryUr" text NOT NULL,
      "retentionSummary" jsonb NOT NULL,
      CONSTRAINT "PK_policy_versions" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------ §4.11 · append-only
    `CREATE TABLE "consents" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "userId" uuid NOT NULL,
      "policyVersionId" uuid NOT NULL,
      "policyVersion" varchar(20) NOT NULL,
      "grantedAt" timestamptz NOT NULL,
      "ip" inet NOT NULL,
      "userAgent" varchar(512) NOT NULL,
      "locale" "locale_enum" NOT NULL,
      CONSTRAINT "PK_consents" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.12
    `CREATE TABLE "categories" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "name" varchar(80) NOT NULL,
      "nameUr" varchar(80),
      "slug" varchar(96) NOT NULL,
      "parentId" uuid,
      "coverImageKey" varchar(512),
      "position" integer NOT NULL DEFAULT 0,
      "archived" boolean NOT NULL DEFAULT false,
      "archivedAt" timestamptz,
      "publishedGarmentCount" integer NOT NULL DEFAULT 0,
      CONSTRAINT "PK_categories" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.13
    `CREATE TABLE "garments" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "sku" varchar(64) NOT NULL,
      "title" varchar(160) NOT NULL,
      "titleUr" varchar(160),
      "slug" varchar(200) NOT NULL,
      "categoryId" uuid NOT NULL,
      "colors" text[] NOT NULL DEFAULT '{}',
      "fabric" varchar(80),
      "embellishmentWeight" "embellishment_weight_enum" NOT NULL,
      "price" numeric(18,2) NOT NULL,
      "currency" char(3) NOT NULL DEFAULT 'PKR',
      "mode" "garment_mode_enum" NOT NULL,
      "deposit" numeric(18,2),
      "description" text,
      "descriptionUr" text,
      "sizes" text[] NOT NULL DEFAULT '{}',
      "styleTags" text[] NOT NULL DEFAULT '{}',
      "publishState" "publish_state_enum" NOT NULL DEFAULT 'DRAFT',
      "publishedAt" timestamptz,
      "qualityScore" integer,
      "qualityChecks" jsonb,
      "qualityOverriddenBy" uuid,
      "qualityOverriddenAt" timestamptz,
      "testRenderId" uuid,
      "testRenderState" "test_render_state_enum" NOT NULL DEFAULT 'NONE',
      "testRenderApprovedAt" timestamptz,
      "approvedBy" uuid,
      "flaggedForReview" boolean NOT NULL DEFAULT false,
      "tryOnCount" integer NOT NULL DEFAULT 0,
      "loveCount" integer NOT NULL DEFAULT 0,
      "maybeCount" integer NOT NULL DEFAULT 0,
      "rejectCount" integer NOT NULL DEFAULT 0,
      "enquiryCount" integer NOT NULL DEFAULT 0,
      "failureCount" integer NOT NULL DEFAULT 0,
      "lastTriedAt" timestamptz,
      CONSTRAINT "PK_garments" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.14
    `CREATE TABLE "garment_images" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "garmentId" uuid NOT NULL,
      "storageKey" varchar(512) NOT NULL,
      "thumbnailKey" varchar(512),
      "isTryOnSource" boolean NOT NULL DEFAULT false,
      "hash" char(64) NOT NULL,
      "width" integer NOT NULL,
      "height" integer NOT NULL,
      "byteSize" integer NOT NULL,
      "mimeType" varchar(64) NOT NULL,
      "position" integer NOT NULL DEFAULT 0,
      "altText" varchar(255),
      CONSTRAINT "PK_garment_images" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.15
    `CREATE TABLE "reference_models" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "label" varchar(80) NOT NULL,
      "storageKey" varchar(512) NOT NULL,
      "thumbnailKey" varchar(512),
      "hash" char(64) NOT NULL,
      "isDefault" boolean NOT NULL DEFAULT false,
      "position" integer NOT NULL DEFAULT 0,
      "active" boolean NOT NULL DEFAULT true,
      CONSTRAINT "PK_reference_models" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.16
    `CREATE TABLE "person_photos" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid NOT NULL,
      "storageKey" varchar(512) NOT NULL,
      "blurredThumbnailKey" varchar(512),
      "hash" char(64) NOT NULL,
      "isActive" boolean NOT NULL DEFAULT false,
      "label" varchar(60),
      "uploadedAt" timestamptz NOT NULL,
      "purgeAfter" timestamptz NOT NULL,
      "moderationState" "photo_moderation_state_enum" NOT NULL DEFAULT 'PENDING',
      "width" integer NOT NULL,
      "height" integer NOT NULL,
      "byteSize" integer NOT NULL,
      "mimeType" varchar(64) NOT NULL,
      CONSTRAINT "PK_person_photos" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.17
    `CREATE TABLE "tryon_jobs" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid NOT NULL,
      "garmentId" uuid,
      "personPhotoId" uuid,
      "referenceModelId" uuid,
      "origin" "job_origin_enum" NOT NULL,
      "isTestRender" boolean NOT NULL DEFAULT false,
      "idempotencyKey" varchar(80) NOT NULL,
      "status" "job_status_enum" NOT NULL DEFAULT 'QUEUED',
      "cacheHit" boolean NOT NULL DEFAULT false,
      "cacheKey" char(64),
      "errorCode" varchar(64),
      "attempts" integer NOT NULL DEFAULT 0,
      "batchId" uuid,
      "startedAt" timestamptz,
      "finishedAt" timestamptz,
      "durationMs" integer,
      CONSTRAINT "PK_tryon_jobs" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.18
    // Every foreign key on this table is nullable with ON DELETE SET NULL, and the
    // snapshot columns carry the history when the parents are gone (C-28, C-29).
    `CREATE TABLE "tryon_results" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "jobId" uuid,
      "userId" uuid,
      "garmentId" uuid,
      "personPhotoId" uuid,
      "storageKey" varchar(512) NOT NULL,
      "thumbnailKey" varchar(512),
      "cacheKey" char(64) NOT NULL,
      "garmentTitleSnapshot" varchar(160) NOT NULL,
      "garmentCategorySnapshot" varchar(80) NOT NULL,
      "garmentPriceSnapshot" numeric(18,2),
      "garmentCurrencySnapshot" char(3) NOT NULL DEFAULT 'PKR',
      "personPhotoLabelSnapshot" varchar(60),
      "isTestRender" boolean NOT NULL DEFAULT false,
      "width" integer NOT NULL,
      "height" integer NOT NULL,
      "byteSize" integer NOT NULL,
      "marketingOptInAt" timestamptz,
      CONSTRAINT "PK_tryon_results" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.19
    `CREATE TABLE "tryon_cache" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "cacheKey" char(64) NOT NULL,
      "garmentSourceHash" char(64) NOT NULL,
      "personPhotoHash" char(64) NOT NULL,
      "apiVersion" varchar(32) NOT NULL,
      "garmentId" uuid,
      "storageKey" varchar(512) NOT NULL,
      "width" integer NOT NULL,
      "height" integer NOT NULL,
      "hitCount" integer NOT NULL DEFAULT 0,
      "lastHitAt" timestamptz,
      CONSTRAINT "PK_tryon_cache" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.20
    `CREATE TABLE "shortlist_items" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid NOT NULL,
      "garmentId" uuid NOT NULL,
      "verdict" "verdict_enum" NOT NULL,
      "rank" integer,
      "rejectReason" "reject_reason_enum",
      "note" text,
      "latestResultId" uuid,
      "verdictAt" timestamptz NOT NULL,
      CONSTRAINT "PK_shortlist_items" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.21
    `CREATE TABLE "share_links" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "userId" uuid NOT NULL,
      "tokenHash" char(64) NOT NULL,
      "label" varchar(60),
      "expiresAt" timestamptz NOT NULL,
      "revokedAt" timestamptz,
      "viewCount" integer NOT NULL DEFAULT 0,
      "lastViewedAt" timestamptz,
      CONSTRAINT "PK_share_links" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.22
    `CREATE TABLE "votes" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "shareLinkId" uuid NOT NULL,
      "garmentId" uuid NOT NULL,
      "voterLabel" varchar(60) NOT NULL,
      "voterFingerprint" char(64) NOT NULL,
      "reaction" "reaction_enum" NOT NULL,
      "comment" text,
      CONSTRAINT "PK_votes" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.23
    `CREATE TABLE "enquiries" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "reference" varchar(20) NOT NULL,
      "userId" uuid NOT NULL,
      "message" text NOT NULL,
      "status" "enquiry_status_enum" NOT NULL DEFAULT 'NEW',
      "lostReason" text,
      "eventDate" date,
      "eventType" "event_type_enum",
      "budgetBand" "budget_band_enum",
      "contactName" varchar(120) NOT NULL,
      "contactEmail" varchar(320) NOT NULL,
      "contactPhone" varchar(24) NOT NULL,
      "firstRespondedAt" timestamptz,
      "closedAt" timestamptz,
      "assignedTo" uuid,
      "totalValueSnapshot" numeric(18,2),
      CONSTRAINT "PK_enquiries" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.24
    `CREATE TABLE "enquiry_items" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "enquiryId" uuid NOT NULL,
      "garmentId" uuid,
      "resultId" uuid,
      "rank" integer NOT NULL,
      "note" text,
      "garmentTitleSnapshot" varchar(160) NOT NULL,
      "garmentSkuSnapshot" varchar(64) NOT NULL,
      "garmentPriceSnapshot" numeric(18,2),
      CONSTRAINT "PK_enquiry_items" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------ §4.25 · append-only
    `CREATE TABLE "enquiry_notes" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "enquiryId" uuid NOT NULL,
      "authorId" uuid,
      "body" text NOT NULL,
      CONSTRAINT "PK_enquiry_notes" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------ §4.26 · append-only
    // No balance column. Remaining quota is SUM(delta) (§4.0 rule 10).
    `CREATE TABLE "quota_ledger" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "userId" uuid NOT NULL,
      "delta" integer NOT NULL,
      "reason" "quota_reason_enum" NOT NULL,
      "period" char(7) NOT NULL,
      "jobId" uuid,
      "actorId" uuid,
      "note" varchar(255),
      CONSTRAINT "PK_quota_ledger" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------ §4.27 · append-only
    // `balanceAfter` is an advisory snapshot for the A-33 chart, never authority.
    `CREATE TABLE "usage_ledger" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "delta" integer NOT NULL,
      "reason" "usage_reason_enum" NOT NULL,
      "period" char(7) NOT NULL,
      "jobId" uuid,
      "userId" uuid,
      "balanceAfter" integer NOT NULL,
      "actorId" uuid,
      "note" varchar(255),
      CONSTRAINT "PK_usage_ledger" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.28
    `CREATE TABLE "settings" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "key" varchar(80) NOT NULL,
      "value" jsonb NOT NULL,
      "valueType" "settings_value_type_enum" NOT NULL,
      "description" varchar(255) NOT NULL,
      "isPublic" boolean NOT NULL DEFAULT false,
      "updatedBy" uuid,
      CONSTRAINT "PK_settings" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.29
    `CREATE TABLE "moderation_items" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "personPhotoId" uuid,
      "userId" uuid,
      "jobId" uuid,
      "source" "moderation_source_enum" NOT NULL,
      "reasonCode" varchar(64) NOT NULL,
      "state" "moderation_state_enum" NOT NULL DEFAULT 'PENDING',
      "blurredThumbnailKey" varchar(512),
      "reviewedBy" uuid,
      "reviewedAt" timestamptz,
      "decisionNote" text,
      CONSTRAINT "PK_moderation_items" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------ §4.30 · append-only
    `CREATE TABLE "audit_log" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "actorId" uuid,
      "actorRole" "role_enum",
      "action" varchar(80) NOT NULL,
      "targetType" varchar(60) NOT NULL,
      "targetId" uuid,
      "targetLabel" varchar(160),
      "metadata" jsonb NOT NULL DEFAULT '{}',
      "ip" inet,
      "userAgent" varchar(512),
      "requestId" uuid,
      CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
    )`,

    // ------------------------------------------------ §4.31 · append-only
    `CREATE TABLE "deletion_log" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "subjectType" "deletion_subject_enum" NOT NULL,
      "subjectId" uuid NOT NULL,
      "userId" uuid,
      "initiatedBy" "deletion_initiator_enum" NOT NULL,
      "actorId" uuid,
      "requestedAt" timestamptz NOT NULL,
      "completedAt" timestamptz,
      "rowsDeleted" jsonb NOT NULL,
      "storageKeysDeleted" integer NOT NULL,
      "bytesReclaimed" bigint NOT NULL,
      "verificationHash" char(64) NOT NULL,
      "failureReason" text,
      CONSTRAINT "PK_deletion_log" PRIMARY KEY ("id")
    )`,

    // --------------------------------------------------------------- §4.32
    `CREATE TABLE "notifications_outbox" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "deletedAt" timestamptz,
      "channel" "notification_channel_enum" NOT NULL,
      "template" varchar(80) NOT NULL,
      "locale" "locale_enum" NOT NULL,
      "recipientUserId" uuid,
      "recipientAddress" varchar(320),
      "payload" jsonb NOT NULL,
      "status" "notification_status_enum" NOT NULL DEFAULT 'PENDING',
      "attempts" integer NOT NULL DEFAULT 0,
      "availableAt" timestamptz NOT NULL,
      "sentAt" timestamptz,
      "readAt" timestamptz,
      "lastError" varchar(512),
      "dedupeKey" varchar(160),
      CONSTRAINT "PK_notifications_outbox" PRIMARY KEY ("id")
    )`,
  ];

  /** Reverse-drop order for `tables`. */
  private readonly tableNames: string[] = [
    'users',
    'consumer_profiles',
    'sessions',
    'verification_tokens',
    'auth_attempts',
    'ip_blocks',
    'invites',
    'policy_versions',
    'consents',
    'categories',
    'garments',
    'garment_images',
    'reference_models',
    'person_photos',
    'tryon_jobs',
    'tryon_results',
    'tryon_cache',
    'shortlist_items',
    'share_links',
    'votes',
    'enquiries',
    'enquiry_items',
    'enquiry_notes',
    'quota_ledger',
    'usage_ledger',
    'settings',
    'moderation_items',
    'audit_log',
    'deletion_log',
    'notifications_outbox',
  ];

  /* ======================================================================== */
  /* 3. Indexes                                                               */
  /* ======================================================================== */

  /**
   * Exactly the indexes listed in §4.3 – §4.32. Every unique index on a
   * soft-deletable table carries `WHERE "deletedAt" IS NULL` (§4.0 rule 4).
   */
  private readonly indexes: string[] = [
    // users (§4.3) — the email uniqueness is on the lower-cased expression
    `CREATE UNIQUE INDEX "UQ_users_email" ON "users" (lower("email")) WHERE "deletedAt" IS NULL`,
    `CREATE UNIQUE INDEX "UQ_users_phone" ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_users_role_status" ON "users" ("role", "status")`,
    `CREATE INDEX "IDX_users_lastActiveAt" ON "users" ("lastActiveAt")`,

    // consumer_profiles (§4.4)
    `CREATE UNIQUE INDEX "UQ_consumer_profiles_userId" ON "consumer_profiles" ("userId") WHERE "deletedAt" IS NULL`,

    // sessions (§4.5)
    `CREATE UNIQUE INDEX "UQ_sessions_tokenHash" ON "sessions" ("tokenHash") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_sessions_userId_revokedAt" ON "sessions" ("userId", "revokedAt")`,
    `CREATE INDEX "IDX_sessions_expiresAt" ON "sessions" ("expiresAt")`,

    // verification_tokens (§4.6)
    `CREATE UNIQUE INDEX "UQ_verification_tokens_tokenHash" ON "verification_tokens" ("tokenHash") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_verification_tokens_userId_purpose" ON "verification_tokens" ("userId", "purpose")`,
    `CREATE INDEX "IDX_verification_tokens_expiresAt" ON "verification_tokens" ("expiresAt")`,

    // auth_attempts (§4.7) — append-only, no unique index at all
    `CREATE INDEX "IDX_auth_attempts_emailHash_createdAt" ON "auth_attempts" ("emailHash", "createdAt")`,
    `CREATE INDEX "IDX_auth_attempts_ip_createdAt" ON "auth_attempts" ("ip", "createdAt")`,
    `CREATE INDEX "IDX_auth_attempts_outcome_createdAt" ON "auth_attempts" ("outcome", "createdAt")`,

    // ip_blocks (§4.8)
    `CREATE UNIQUE INDEX "UQ_ip_blocks_cidr" ON "ip_blocks" ("cidr") WHERE "deletedAt" IS NULL`,

    // invites (§4.9)
    `CREATE UNIQUE INDEX "UQ_invites_tokenHash" ON "invites" ("tokenHash") WHERE "deletedAt" IS NULL`,
    `CREATE UNIQUE INDEX "UQ_invites_email_pending" ON "invites" ("email") WHERE "consumedAt" IS NULL AND "deletedAt" IS NULL`,

    // policy_versions (§4.10) — exactly one current policy at a time
    `CREATE UNIQUE INDEX "UQ_policy_versions_version" ON "policy_versions" ("version") WHERE "deletedAt" IS NULL`,
    `CREATE UNIQUE INDEX "UQ_policy_versions_current" ON "policy_versions" ("isCurrent") WHERE "isCurrent" = true AND "deletedAt" IS NULL`,

    // consents (§4.11) — no unique index: re-consent appends
    `CREATE INDEX "IDX_consents_userId_createdAt" ON "consents" ("userId", "createdAt")`,

    // categories (§4.12)
    `CREATE UNIQUE INDEX "UQ_categories_slug" ON "categories" ("slug") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_categories_parentId_position" ON "categories" ("parentId", "position")`,
    `CREATE INDEX "IDX_categories_archived" ON "categories" ("archived")`,

    // garments (§4.13)
    `CREATE UNIQUE INDEX "UQ_garments_sku" ON "garments" ("sku") WHERE "deletedAt" IS NULL`,
    `CREATE UNIQUE INDEX "UQ_garments_slug" ON "garments" ("slug") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_garments_publishState_categoryId" ON "garments" ("publishState", "categoryId")`,
    `CREATE INDEX "IDX_garments_publishState_createdAt" ON "garments" ("publishState", "createdAt")`,
    `CREATE INDEX "IDX_garments_testRenderState" ON "garments" ("testRenderState")`,
    `CREATE INDEX "IDX_garments_flaggedForReview" ON "garments" ("flaggedForReview") WHERE "flaggedForReview" = true`,
    `CREATE INDEX "IDX_garments_colors_gin" ON "garments" USING GIN ("colors")`,
    `CREATE INDEX "IDX_garments_sizes_gin" ON "garments" USING GIN ("sizes")`,
    `CREATE INDEX "IDX_garments_styleTags_gin" ON "garments" USING GIN ("styleTags")`,
    // C-17 search: trigram similarity on the title
    `CREATE INDEX "IDX_garments_title_trgm" ON "garments" USING GIN ("title" gin_trgm_ops)`,

    // garment_images (§4.14) — exactly one try-on source per garment
    `CREATE INDEX "IDX_garment_images_garmentId_position" ON "garment_images" ("garmentId", "position")`,
    `CREATE UNIQUE INDEX "UQ_garment_images_source" ON "garment_images" ("garmentId") WHERE "isTryOnSource" = true AND "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_garment_images_hash" ON "garment_images" ("hash")`,

    // reference_models (§4.15)
    `CREATE UNIQUE INDEX "UQ_reference_models_default" ON "reference_models" ("isDefault") WHERE "isDefault" = true AND "deletedAt" IS NULL`,

    // person_photos (§4.16)
    `CREATE UNIQUE INDEX "UQ_person_photos_active" ON "person_photos" ("userId") WHERE "isActive" = true AND "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_person_photos_userId" ON "person_photos" ("userId")`,
    `CREATE INDEX "IDX_person_photos_purgeAfter" ON "person_photos" ("purgeAfter")`,
    `CREATE INDEX "IDX_person_photos_hash" ON "person_photos" ("hash")`,

    // tryon_jobs (§4.17) — the unique index IS the idempotency mechanism
    `CREATE UNIQUE INDEX "UQ_tryon_jobs_idem" ON "tryon_jobs" ("userId", "idempotencyKey") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_tryon_jobs_userId_status" ON "tryon_jobs" ("userId", "status")`,
    `CREATE INDEX "IDX_tryon_jobs_status_createdAt" ON "tryon_jobs" ("status", "createdAt")`,
    `CREATE INDEX "IDX_tryon_jobs_batchId" ON "tryon_jobs" ("batchId")`,
    `CREATE INDEX "IDX_tryon_jobs_garmentId" ON "tryon_jobs" ("garmentId")`,

    // tryon_results (§4.18)
    `CREATE INDEX "IDX_tryon_results_userId_createdAt" ON "tryon_results" ("userId", "createdAt")`,
    `CREATE INDEX "IDX_tryon_results_userId_garmentId" ON "tryon_results" ("userId", "garmentId")`,
    `CREATE INDEX "IDX_tryon_results_personPhotoId" ON "tryon_results" ("personPhotoId")`,
    `CREATE INDEX "IDX_tryon_results_cacheKey" ON "tryon_results" ("cacheKey")`,
    `CREATE INDEX "IDX_tryon_results_jobId" ON "tryon_results" ("jobId")`,

    // tryon_cache (§4.19)
    `CREATE UNIQUE INDEX "UQ_tryon_cache_cacheKey" ON "tryon_cache" ("cacheKey") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_tryon_cache_personPhotoHash" ON "tryon_cache" ("personPhotoHash")`,
    `CREATE INDEX "IDX_tryon_cache_garmentId" ON "tryon_cache" ("garmentId")`,

    // shortlist_items (§4.20)
    `CREATE UNIQUE INDEX "UQ_shortlist_items_user_garment" ON "shortlist_items" ("userId", "garmentId") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_shortlist_items_userId_rank" ON "shortlist_items" ("userId", "rank")`,
    `CREATE INDEX "IDX_shortlist_items_garmentId_verdict" ON "shortlist_items" ("garmentId", "verdict")`,

    // share_links (§4.21)
    `CREATE UNIQUE INDEX "UQ_share_links_tokenHash" ON "share_links" ("tokenHash") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_share_links_userId" ON "share_links" ("userId")`,
    `CREATE INDEX "IDX_share_links_expiresAt" ON "share_links" ("expiresAt")`,

    // votes (§4.22)
    `CREATE UNIQUE INDEX "UQ_votes_link_voter_garment" ON "votes" ("shareLinkId", "voterFingerprint", "garmentId") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_votes_shareLinkId" ON "votes" ("shareLinkId")`,

    // enquiries (§4.23)
    `CREATE UNIQUE INDEX "UQ_enquiries_reference" ON "enquiries" ("reference") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_enquiries_status_createdAt" ON "enquiries" ("status", "createdAt")`,
    `CREATE INDEX "IDX_enquiries_userId_createdAt" ON "enquiries" ("userId", "createdAt")`,
    `CREATE INDEX "IDX_enquiries_firstRespondedAt" ON "enquiries" ("firstRespondedAt") WHERE "firstRespondedAt" IS NULL`,

    // enquiry_items (§4.24)
    `CREATE UNIQUE INDEX "UQ_enquiry_items_enquiry_rank" ON "enquiry_items" ("enquiryId", "rank") WHERE "deletedAt" IS NULL`,
    `CREATE INDEX "IDX_enquiry_items_garmentId" ON "enquiry_items" ("garmentId")`,

    // enquiry_notes (§4.25) — append-only
    `CREATE INDEX "IDX_enquiry_notes_enquiryId_createdAt" ON "enquiry_notes" ("enquiryId", "createdAt")`,

    // quota_ledger (§4.26) — append-only: NO "deletedAt" predicate on the unique
    // index, deliberately. It is what makes a double consumption impossible.
    `CREATE INDEX "IDX_quota_ledger_userId_period" ON "quota_ledger" ("userId", "period")`,
    `CREATE UNIQUE INDEX "UQ_quota_ledger_job" ON "quota_ledger" ("jobId") WHERE "jobId" IS NOT NULL`,

    // usage_ledger (§4.27) — append-only: same exception
    `CREATE INDEX "IDX_usage_ledger_period_createdAt" ON "usage_ledger" ("period", "createdAt")`,
    `CREATE UNIQUE INDEX "UQ_usage_ledger_job" ON "usage_ledger" ("jobId") WHERE "jobId" IS NOT NULL`,

    // settings (§4.28)
    `CREATE UNIQUE INDEX "UQ_settings_key" ON "settings" ("key") WHERE "deletedAt" IS NULL`,

    // moderation_items (§4.29)
    `CREATE INDEX "IDX_moderation_items_state_createdAt" ON "moderation_items" ("state", "createdAt")`,
    `CREATE INDEX "IDX_moderation_items_userId" ON "moderation_items" ("userId")`,
    `CREATE UNIQUE INDEX "UQ_moderation_items_photo_pending" ON "moderation_items" ("personPhotoId") WHERE "state" = 'PENDING' AND "deletedAt" IS NULL`,

    // audit_log (§4.30) — append-only
    `CREATE INDEX "IDX_audit_log_actorId_createdAt" ON "audit_log" ("actorId", "createdAt")`,
    `CREATE INDEX "IDX_audit_log_action_createdAt" ON "audit_log" ("action", "createdAt")`,
    `CREATE INDEX "IDX_audit_log_target" ON "audit_log" ("targetType", "targetId")`,

    // deletion_log (§4.31) — the partial index is the E-14 purge-failure alert query
    `CREATE INDEX "IDX_deletion_log_subject" ON "deletion_log" ("subjectType", "subjectId")`,
    `CREATE INDEX "IDX_deletion_log_completedAt" ON "deletion_log" ("completedAt") WHERE "completedAt" IS NULL`,

    // notifications_outbox (§4.32)
    `CREATE INDEX "IDX_notifications_outbox_status_availableAt" ON "notifications_outbox" ("status", "availableAt") WHERE "status" = 'PENDING'`,
    `CREATE INDEX "IDX_notifications_outbox_recipient_read" ON "notifications_outbox" ("recipientUserId", "readAt")`,
    `CREATE UNIQUE INDEX "UQ_notifications_outbox_dedupe" ON "notifications_outbox" ("dedupeKey") WHERE "dedupeKey" IS NOT NULL AND "deletedAt" IS NULL`,
  ];

  /**
   * §4.0 rule 9 — "foreign-key columns are always indexed". These are the FK columns
   * whose §4 index list does not already cover them as a leading column.
   */
  private readonly foreignKeyIndexes: string[] = [
    `CREATE INDEX "IDX_users_invitedBy" ON "users" ("invitedBy")`,
    `CREATE INDEX "IDX_auth_attempts_userId" ON "auth_attempts" ("userId")`,
    `CREATE INDEX "IDX_ip_blocks_createdBy" ON "ip_blocks" ("createdBy")`,
    `CREATE INDEX "IDX_invites_invitedBy" ON "invites" ("invitedBy")`,
    `CREATE INDEX "IDX_invites_consumedByUserId" ON "invites" ("consumedByUserId")`,
    `CREATE INDEX "IDX_consents_policyVersionId" ON "consents" ("policyVersionId")`,
    `CREATE INDEX "IDX_garments_categoryId" ON "garments" ("categoryId")`,
    `CREATE INDEX "IDX_garments_testRenderId" ON "garments" ("testRenderId")`,
    `CREATE INDEX "IDX_garments_approvedBy" ON "garments" ("approvedBy")`,
    `CREATE INDEX "IDX_garments_qualityOverriddenBy" ON "garments" ("qualityOverriddenBy")`,
    `CREATE INDEX "IDX_tryon_jobs_personPhotoId" ON "tryon_jobs" ("personPhotoId")`,
    `CREATE INDEX "IDX_tryon_jobs_referenceModelId" ON "tryon_jobs" ("referenceModelId")`,
    `CREATE INDEX "IDX_tryon_results_garmentId" ON "tryon_results" ("garmentId")`,
    `CREATE INDEX "IDX_shortlist_items_latestResultId" ON "shortlist_items" ("latestResultId")`,
    `CREATE INDEX "IDX_votes_garmentId" ON "votes" ("garmentId")`,
    `CREATE INDEX "IDX_enquiries_assignedTo" ON "enquiries" ("assignedTo")`,
    `CREATE INDEX "IDX_enquiry_items_resultId" ON "enquiry_items" ("resultId")`,
    `CREATE INDEX "IDX_enquiry_notes_authorId" ON "enquiry_notes" ("authorId")`,
    `CREATE INDEX "IDX_quota_ledger_actorId" ON "quota_ledger" ("actorId")`,
    `CREATE INDEX "IDX_usage_ledger_userId" ON "usage_ledger" ("userId")`,
    `CREATE INDEX "IDX_usage_ledger_actorId" ON "usage_ledger" ("actorId")`,
    `CREATE INDEX "IDX_settings_updatedBy" ON "settings" ("updatedBy")`,
    `CREATE INDEX "IDX_moderation_items_personPhotoId" ON "moderation_items" ("personPhotoId")`,
    `CREATE INDEX "IDX_moderation_items_jobId" ON "moderation_items" ("jobId")`,
    `CREATE INDEX "IDX_moderation_items_reviewedBy" ON "moderation_items" ("reviewedBy")`,
    `CREATE INDEX "IDX_deletion_log_userId" ON "deletion_log" ("userId")`,
    `CREATE INDEX "IDX_deletion_log_actorId" ON "deletion_log" ("actorId")`,
  ];

  /* ======================================================================== */
  /* 4. Foreign keys (§4.0 rule 8) and append-only rules (§2.1)               */
  /* ======================================================================== */

  /**
   * `CASCADE` when the child cannot exist without the parent, `SET NULL` when the
   * child must survive the parent, `RESTRICT` when deletion must be blocked.
   */
  private readonly foreignKeys: Array<{
    table: string;
    name: string;
    column: string;
    references: string;
    onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  }> = [
    {
      table: 'users',
      name: 'FK_users_invitedBy',
      column: 'invitedBy',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'consumer_profiles',
      name: 'FK_consumer_profiles_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'sessions',
      name: 'FK_sessions_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'verification_tokens',
      name: 'FK_verification_tokens_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'auth_attempts',
      name: 'FK_auth_attempts_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'ip_blocks',
      name: 'FK_ip_blocks_createdBy',
      column: 'createdBy',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'invites',
      name: 'FK_invites_invitedBy',
      column: 'invitedBy',
      references: 'users',
      onDelete: 'RESTRICT',
    },
    {
      table: 'invites',
      name: 'FK_invites_consumedByUserId',
      column: 'consumedByUserId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'consents',
      name: 'FK_consents_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'consents',
      name: 'FK_consents_policyVersionId',
      column: 'policyVersionId',
      references: 'policy_versions',
      onDelete: 'RESTRICT',
    },
    {
      table: 'categories',
      name: 'FK_categories_parentId',
      column: 'parentId',
      references: 'categories',
      onDelete: 'RESTRICT',
    },
    {
      table: 'garments',
      name: 'FK_garments_categoryId',
      column: 'categoryId',
      references: 'categories',
      onDelete: 'RESTRICT',
    },
    {
      table: 'garments',
      name: 'FK_garments_testRenderId',
      column: 'testRenderId',
      references: 'tryon_results',
      onDelete: 'SET NULL',
    },
    {
      table: 'garments',
      name: 'FK_garments_approvedBy',
      column: 'approvedBy',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'garments',
      name: 'FK_garments_qualityOverriddenBy',
      column: 'qualityOverriddenBy',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'garment_images',
      name: 'FK_garment_images_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'CASCADE',
    },
    {
      table: 'person_photos',
      name: 'FK_person_photos_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'tryon_jobs',
      name: 'FK_tryon_jobs_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'tryon_jobs',
      name: 'FK_tryon_jobs_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'SET NULL',
    },
    {
      table: 'tryon_jobs',
      name: 'FK_tryon_jobs_personPhotoId',
      column: 'personPhotoId',
      references: 'person_photos',
      onDelete: 'SET NULL',
    },
    {
      table: 'tryon_jobs',
      name: 'FK_tryon_jobs_referenceModelId',
      column: 'referenceModelId',
      references: 'reference_models',
      onDelete: 'SET NULL',
    },
    // §4.18 — all four SET NULL so history survives (C-27, C-28, C-29)
    {
      table: 'tryon_results',
      name: 'FK_tryon_results_jobId',
      column: 'jobId',
      references: 'tryon_jobs',
      onDelete: 'SET NULL',
    },
    {
      table: 'tryon_results',
      name: 'FK_tryon_results_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'tryon_results',
      name: 'FK_tryon_results_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'SET NULL',
    },
    {
      table: 'tryon_results',
      name: 'FK_tryon_results_personPhotoId',
      column: 'personPhotoId',
      references: 'person_photos',
      onDelete: 'SET NULL',
    },
    {
      table: 'tryon_cache',
      name: 'FK_tryon_cache_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'SET NULL',
    },
    {
      table: 'shortlist_items',
      name: 'FK_shortlist_items_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'shortlist_items',
      name: 'FK_shortlist_items_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'CASCADE',
    },
    {
      table: 'shortlist_items',
      name: 'FK_shortlist_items_latestResultId',
      column: 'latestResultId',
      references: 'tryon_results',
      onDelete: 'SET NULL',
    },
    {
      table: 'share_links',
      name: 'FK_share_links_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'votes',
      name: 'FK_votes_shareLinkId',
      column: 'shareLinkId',
      references: 'share_links',
      onDelete: 'CASCADE',
    },
    {
      table: 'votes',
      name: 'FK_votes_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'CASCADE',
    },
    {
      table: 'enquiries',
      name: 'FK_enquiries_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'enquiries',
      name: 'FK_enquiries_assignedTo',
      column: 'assignedTo',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'enquiry_items',
      name: 'FK_enquiry_items_enquiryId',
      column: 'enquiryId',
      references: 'enquiries',
      onDelete: 'CASCADE',
    },
    {
      table: 'enquiry_items',
      name: 'FK_enquiry_items_garmentId',
      column: 'garmentId',
      references: 'garments',
      onDelete: 'SET NULL',
    },
    {
      table: 'enquiry_items',
      name: 'FK_enquiry_items_resultId',
      column: 'resultId',
      references: 'tryon_results',
      onDelete: 'SET NULL',
    },
    {
      table: 'enquiry_notes',
      name: 'FK_enquiry_notes_enquiryId',
      column: 'enquiryId',
      references: 'enquiries',
      onDelete: 'CASCADE',
    },
    {
      table: 'enquiry_notes',
      name: 'FK_enquiry_notes_authorId',
      column: 'authorId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'quota_ledger',
      name: 'FK_quota_ledger_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'CASCADE',
    },
    {
      table: 'quota_ledger',
      name: 'FK_quota_ledger_jobId',
      column: 'jobId',
      references: 'tryon_jobs',
      onDelete: 'SET NULL',
    },
    {
      table: 'quota_ledger',
      name: 'FK_quota_ledger_actorId',
      column: 'actorId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'usage_ledger',
      name: 'FK_usage_ledger_jobId',
      column: 'jobId',
      references: 'tryon_jobs',
      onDelete: 'SET NULL',
    },
    {
      table: 'usage_ledger',
      name: 'FK_usage_ledger_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'usage_ledger',
      name: 'FK_usage_ledger_actorId',
      column: 'actorId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'settings',
      name: 'FK_settings_updatedBy',
      column: 'updatedBy',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'moderation_items',
      name: 'FK_moderation_items_personPhotoId',
      column: 'personPhotoId',
      references: 'person_photos',
      onDelete: 'SET NULL',
    },
    {
      table: 'moderation_items',
      name: 'FK_moderation_items_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'moderation_items',
      name: 'FK_moderation_items_jobId',
      column: 'jobId',
      references: 'tryon_jobs',
      onDelete: 'SET NULL',
    },
    {
      table: 'moderation_items',
      name: 'FK_moderation_items_reviewedBy',
      column: 'reviewedBy',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'audit_log',
      name: 'FK_audit_log_actorId',
      column: 'actorId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'deletion_log',
      name: 'FK_deletion_log_userId',
      column: 'userId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'deletion_log',
      name: 'FK_deletion_log_actorId',
      column: 'actorId',
      references: 'users',
      onDelete: 'SET NULL',
    },
    {
      table: 'notifications_outbox',
      name: 'FK_notifications_outbox_recipientUserId',
      column: 'recipientUserId',
      references: 'users',
      onDelete: 'CASCADE',
    },
  ];

  /**
   * §2.1 — the database-level guard on every `AppendOnlyEntity` table. Rows are
   * INSERTed and read; an UPDATE or DELETE silently does nothing.
   *
   * `audit_log` and `deletion_log` are the documented exception: their rows may be
   * physically removed by an **explicitly reviewed retention migration**, which must
   * `DROP RULE "no_delete_audit_log" ON "audit_log"`, delete, and recreate the rule.
   * Application code never does this.
   */
  private readonly appendOnlyTables: string[] = [
    'auth_attempts',
    'consents',
    'enquiry_notes',
    'quota_ledger',
    'usage_ledger',
    'audit_log',
    'deletion_log',
  ];

  /* ======================================================================== */

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of this.extensions) {
      await queryRunner.query(statement);
    }

    for (const statement of this.enumTypes) {
      await queryRunner.query(statement);
    }

    for (const statement of this.tables) {
      await queryRunner.query(statement);
    }

    for (const statement of [...this.indexes, ...this.foreignKeyIndexes]) {
      await queryRunner.query(statement);
    }

    for (const fk of this.foreignKeys) {
      await queryRunner.query(
        `ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fk.name}" ` +
          `FOREIGN KEY ("${fk.column}") REFERENCES "${fk.references}" ("id") ` +
          `ON DELETE ${fk.onDelete} ON UPDATE NO ACTION`,
      );
    }

    for (const table of this.appendOnlyTables) {
      await queryRunner.query(
        `CREATE RULE "no_update_${table}" AS ON UPDATE TO "${table}" DO INSTEAD NOTHING`,
      );
      await queryRunner.query(
        `CREATE RULE "no_delete_${table}" AS ON DELETE TO "${table}" DO INSTEAD NOTHING`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...this.appendOnlyTables].reverse()) {
      await queryRunner.query(`DROP RULE IF EXISTS "no_delete_${table}" ON "${table}"`);
      await queryRunner.query(`DROP RULE IF EXISTS "no_update_${table}" ON "${table}"`);
    }

    for (const fk of [...this.foreignKeys].reverse()) {
      await queryRunner.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT "${fk.name}"`);
    }

    for (const statement of [...this.indexes, ...this.foreignKeyIndexes].reverse()) {
      const name = /CREATE (?:UNIQUE )?INDEX "([^"]+)"/.exec(statement)?.[1];
      if (name) {
        await queryRunner.query(`DROP INDEX "${name}"`);
      }
    }

    for (const table of [...this.tableNames].reverse()) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }

    for (const type of [...this.enumTypeNames].reverse()) {
      await queryRunner.query(`DROP TYPE "${type}"`);
    }

    // `uuid-ossp` and `pg_trgm` are intentionally left installed: dropping a shared
    // extension on rollback would break anything else in the database that uses it.
  }
}
