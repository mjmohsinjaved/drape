import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class InitialSchema1785943830311 implements MigrationInterface {
  /**
   * TypeORM records THIS value in `api_migrations`, not the class name — it reads the
   * instance property first and only falls back to `constructor.name`. Renaming the class
   * without renaming this leaves the code and the tracking table disagreeing, and the next
   * `migration:run` tries to re-apply a migration that is already in place.
   */
  name = 'InitialSchema1785943830311';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."role_enum" AS ENUM('ADMIN', 'CONSUMER')`);
    await queryRunner.query(
      `CREATE TYPE "public"."user_status_enum" AS ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."locale_enum" AS ENUM('EN', 'UR')`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "role" "public"."role_enum" NOT NULL, "email" character varying(320) NOT NULL, "emailVerifiedAt" TIMESTAMP WITH TIME ZONE, "passwordHash" character varying(255) NOT NULL, "name" character varying(120) NOT NULL, "phone" character varying(24), "phoneVerifiedAt" TIMESTAMP WITH TIME ZONE, "twofaSecret" character varying(255), "twofaEnabledAt" TIMESTAMP WITH TIME ZONE, "twofaRecoveryCodes" text array, "status" "public"."user_status_enum" NOT NULL DEFAULT 'ACTIVE', "suspendedReason" text, "suspendedAt" TIMESTAMP WITH TIME ZONE, "invitedBy" uuid, "lastLoginAt" TIMESTAMP WITH TIME ZONE, "lastActiveAt" TIMESTAMP WITH TIME ZONE, "failedLoginCount" integer NOT NULL DEFAULT '0', "lockedUntil" TIMESTAMP WITH TIME ZONE, "locale" "public"."locale_enum" NOT NULL DEFAULT 'EN', "deletionRequestedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_users_invitedBy" ON "users" ("invitedBy") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_users_phone" ON "users" ("phone") WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_users_lastActiveAt" ON "users" ("lastActiveAt") `);
    await queryRunner.query(`CREATE INDEX "IDX_users_role_status" ON "users" ("role", "status") `);
    await queryRunner.query(
      `CREATE TYPE "public"."event_type_enum" AS ENUM('MEHNDI', 'NIKKAH', 'BARAAT', 'WALIMA', 'ENGAGEMENT', 'RECEPTION', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."budget_band_enum" AS ENUM('UNDER_100K', 'BAND_100K_250K', 'BAND_250K_500K', 'BAND_500K_1M', 'ABOVE_1M')`,
    );
    await queryRunner.query(
      `CREATE TABLE "consumer_profiles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, "eventDate" date, "eventType" "public"."event_type_enum", "budgetBand" "public"."budget_band_enum", "preferredCategories" uuid array NOT NULL DEFAULT '{}', "monthlyQuotaOverride" integer, "notificationPreferences" jsonb NOT NULL DEFAULT '{}', "onboardingCompletedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "REL_a4a26cde310b21650c253c3b7c" UNIQUE ("userId"), CONSTRAINT "PK_10d8f9d6ae638a6b62579a48175" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_consumer_profiles_userId" ON "consumer_profiles" ("userId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(80) NOT NULL, "nameUr" character varying(80), "slug" character varying(96) NOT NULL, "parentId" uuid, "coverImageKey" character varying(512), "position" integer NOT NULL DEFAULT '0', "archived" boolean NOT NULL DEFAULT false, "archivedAt" TIMESTAMP WITH TIME ZONE, "publishedGarmentCount" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_categories_archived" ON "categories" ("archived") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_categories_parentId_position" ON "categories" ("parentId", "position") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_categories_slug" ON "categories" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."embellishment_weight_enum" AS ENUM('LIGHT', 'MEDIUM', 'HEAVY')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."garment_mode_enum" AS ENUM('SALE', 'RENTAL')`);
    await queryRunner.query(
      `CREATE TYPE "public"."publish_state_enum" AS ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."test_render_state_enum" AS ENUM('NONE', 'PENDING', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "garments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "sku" character varying(64) NOT NULL, "title" character varying(160) NOT NULL, "titleUr" character varying(160), "slug" character varying(200) NOT NULL, "categoryId" uuid NOT NULL, "colors" text array NOT NULL DEFAULT '{}', "fabric" character varying(80), "embellishmentWeight" "public"."embellishment_weight_enum" NOT NULL, "price" numeric(18,2) NOT NULL, "currency" character(3) NOT NULL DEFAULT 'PKR', "mode" "public"."garment_mode_enum" NOT NULL, "deposit" numeric(18,2), "description" text, "descriptionUr" text, "sizes" text array NOT NULL DEFAULT '{}', "styleTags" text array NOT NULL DEFAULT '{}', "publishState" "public"."publish_state_enum" NOT NULL DEFAULT 'DRAFT', "publishedAt" TIMESTAMP WITH TIME ZONE, "qualityScore" integer, "qualityChecks" jsonb, "qualityOverriddenBy" uuid, "qualityOverriddenAt" TIMESTAMP WITH TIME ZONE, "testRenderId" uuid, "testRenderState" "public"."test_render_state_enum" NOT NULL DEFAULT 'NONE', "testRenderApprovedAt" TIMESTAMP WITH TIME ZONE, "approvedBy" uuid, "flaggedForReview" boolean NOT NULL DEFAULT false, "tryOnCount" integer NOT NULL DEFAULT '0', "loveCount" integer NOT NULL DEFAULT '0', "maybeCount" integer NOT NULL DEFAULT '0', "rejectCount" integer NOT NULL DEFAULT '0', "enquiryCount" integer NOT NULL DEFAULT '0', "failureCount" integer NOT NULL DEFAULT '0', "lastTriedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d2c461b69b3fd4e8408983fb2b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_garments_qualityOverriddenBy" ON "garments" ("qualityOverriddenBy") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_garments_approvedBy" ON "garments" ("approvedBy") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_garments_testRenderId" ON "garments" ("testRenderId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_garments_categoryId" ON "garments" ("categoryId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_garments_flaggedForReview" ON "garments" ("flaggedForReview") WHERE "flaggedForReview" = true`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_garments_testRenderState" ON "garments" ("testRenderState") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_garments_publishState_createdAt" ON "garments" ("publishState", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_garments_publishState_categoryId" ON "garments" ("publishState", "categoryId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_garments_slug" ON "garments" ("slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_garments_sku" ON "garments" ("sku") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."photo_moderation_state_enum" AS ENUM('PENDING', 'APPROVED', 'BLOCKED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "person_photos" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, "storageKey" character varying(512) NOT NULL, "blurredThumbnailKey" character varying(512), "hash" character(64) NOT NULL, "isActive" boolean NOT NULL DEFAULT false, "label" character varying(60), "uploadedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "purgeAfter" TIMESTAMP WITH TIME ZONE NOT NULL, "moderationState" "public"."photo_moderation_state_enum" NOT NULL DEFAULT 'PENDING', "width" integer NOT NULL, "height" integer NOT NULL, "byteSize" integer NOT NULL, "mimeType" character varying(64) NOT NULL, CONSTRAINT "PK_5a62ba75233ae0dd6c9dee6d306" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_person_photos_hash" ON "person_photos" ("hash") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_person_photos_purgeAfter" ON "person_photos" ("purgeAfter") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_person_photos_userId" ON "person_photos" ("userId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_person_photos_active" ON "person_photos" ("userId") WHERE "isActive" = true AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "reference_models" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "label" character varying(80) NOT NULL, "storageKey" character varying(512) NOT NULL, "thumbnailKey" character varying(512), "hash" character(64) NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, "position" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_e600543452c63208d770a3cf071" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_reference_models_default" ON "reference_models" ("isDefault") WHERE "isDefault" = true AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_origin_enum" AS ENUM('CONSUMER', 'TEST_RENDER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_status_enum" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tryon_jobs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, "garmentId" uuid, "personPhotoId" uuid, "referenceModelId" uuid, "origin" "public"."job_origin_enum" NOT NULL, "isTestRender" boolean NOT NULL DEFAULT false, "idempotencyKey" character varying(80) NOT NULL, "status" "public"."job_status_enum" NOT NULL DEFAULT 'QUEUED', "cacheHit" boolean NOT NULL DEFAULT false, "cacheKey" character(64), "errorCode" character varying(64), "attempts" integer NOT NULL DEFAULT '0', "batchId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "durationMs" integer, CONSTRAINT "PK_73b2d3a08eedb11674af5a3ca0d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_jobs_referenceModelId" ON "tryon_jobs" ("referenceModelId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_jobs_personPhotoId" ON "tryon_jobs" ("personPhotoId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_jobs_garmentId" ON "tryon_jobs" ("garmentId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_tryon_jobs_batchId" ON "tryon_jobs" ("batchId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_jobs_status_createdAt" ON "tryon_jobs" ("status", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_jobs_userId_status" ON "tryon_jobs" ("userId", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tryon_jobs_idem" ON "tryon_jobs" ("userId", "idempotencyKey") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "tryon_cache" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "cacheKey" character(64) NOT NULL, "garmentSourceHash" character(64) NOT NULL, "personPhotoHash" character(64) NOT NULL, "apiVersion" character varying(32) NOT NULL, "garmentId" uuid, "storageKey" character varying(512) NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "hitCount" integer NOT NULL DEFAULT '0', "lastHitAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_31ac58cfc97bb9098a654e4b7b1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_cache_garmentId" ON "tryon_cache" ("garmentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_cache_personPhotoHash" ON "tryon_cache" ("personPhotoHash") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tryon_cache_cacheKey" ON "tryon_cache" ("cacheKey") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "tryon_results" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "jobId" uuid, "userId" uuid, "garmentId" uuid, "personPhotoId" uuid, "storageKey" character varying(512) NOT NULL, "thumbnailKey" character varying(512), "cacheKey" character(64) NOT NULL, "garmentTitleSnapshot" character varying(160) NOT NULL, "garmentCategorySnapshot" character varying(80) NOT NULL, "garmentPriceSnapshot" numeric(18,2), "garmentCurrencySnapshot" character(3) NOT NULL DEFAULT 'PKR', "personPhotoLabelSnapshot" character varying(60), "isTestRender" boolean NOT NULL DEFAULT false, "width" integer NOT NULL, "height" integer NOT NULL, "byteSize" integer NOT NULL, "marketingOptInAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f69b9783e9bfdd9bbda179c2dc8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_results_garmentId" ON "tryon_results" ("garmentId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_tryon_results_jobId" ON "tryon_results" ("jobId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_results_cacheKey" ON "tryon_results" ("cacheKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_results_personPhotoId" ON "tryon_results" ("personPhotoId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_results_userId_garmentId" ON "tryon_results" ("userId", "garmentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tryon_results_userId_createdAt" ON "tryon_results" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."verdict_enum" AS ENUM('LOVE_IT', 'MAYBE', 'NOT_FOR_ME')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reject_reason_enum" AS ENUM('NECKLINE', 'COLOR', 'TOO_HEAVY', 'SILHOUETTE', 'PRICE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "shortlist_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, "garmentId" uuid NOT NULL, "verdict" "public"."verdict_enum" NOT NULL, "rank" integer, "rejectReason" "public"."reject_reason_enum", "note" text, "latestResultId" uuid, "verdictAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_4b49bb8061afea8926d9d31e404" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shortlist_items_latestResultId" ON "shortlist_items" ("latestResultId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shortlist_items_garmentId_verdict" ON "shortlist_items" ("garmentId", "verdict") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shortlist_items_userId_rank" ON "shortlist_items" ("userId", "rank") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shortlist_items_user_garment" ON "shortlist_items" ("userId", "garmentId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "share_links" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, "tokenHash" character(64) NOT NULL, "label" character varying(60), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "viewCount" integer NOT NULL DEFAULT '0', "lastViewedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_70320b79ecd8acab96419fcdd6d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_share_links_expiresAt" ON "share_links" ("expiresAt") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_share_links_userId" ON "share_links" ("userId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_share_links_tokenHash" ON "share_links" ("tokenHash") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."reaction_enum" AS ENUM('HEART', 'UNSURE', 'NO')`,
    );
    await queryRunner.query(
      `CREATE TABLE "votes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "shareLinkId" uuid NOT NULL, "garmentId" uuid NOT NULL, "voterLabel" character varying(60) NOT NULL, "voterFingerprint" character(64) NOT NULL, "reaction" "public"."reaction_enum" NOT NULL, "comment" text, CONSTRAINT "PK_f3d9fd4a0af865152c3f59db8ff" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_votes_garmentId" ON "votes" ("garmentId") `);
    await queryRunner.query(`CREATE INDEX "IDX_votes_shareLinkId" ON "votes" ("shareLinkId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_votes_link_voter_garment" ON "votes" ("shareLinkId", "voterFingerprint", "garmentId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."settings_value_type_enum" AS ENUM('STRING', 'NUMBER', 'BOOLEAN', 'JSON')`,
    );
    await queryRunner.query(
      `CREATE TABLE "settings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "key" character varying(80) NOT NULL, "value" jsonb, "valueType" "public"."settings_value_type_enum" NOT NULL, "description" character varying(255) NOT NULL, "isPublic" boolean NOT NULL DEFAULT false, "updatedBy" uuid, CONSTRAINT "PK_0669fe20e252eb692bf4d344975" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_settings_updatedBy" ON "settings" ("updatedBy") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_settings_key" ON "settings" ("key") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."deletion_subject_enum" AS ENUM('USER', 'PERSON_PHOTO', 'TRYON_RESULT', 'SHARE_LINK', 'TRYON_JOB', 'EXPORT_ARCHIVE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."deletion_initiator_enum" AS ENUM('CONSUMER', 'ADMIN', 'PURGE_JOB')`,
    );
    await queryRunner.query(
      `CREATE TABLE "deletion_log" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "subjectType" "public"."deletion_subject_enum" NOT NULL, "subjectId" uuid NOT NULL, "userId" uuid, "initiatedBy" "public"."deletion_initiator_enum" NOT NULL, "actorId" uuid, "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE, "rowsDeleted" jsonb NOT NULL, "storageKeysDeleted" integer NOT NULL, "bytesReclaimed" bigint NOT NULL, "verificationHash" character(64) NOT NULL, "failureReason" text, CONSTRAINT "PK_7f5f656ea65e0bc627e02584201" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_deletion_log_actorId" ON "deletion_log" ("actorId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_deletion_log_userId" ON "deletion_log" ("userId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_deletion_log_completedAt" ON "deletion_log" ("completedAt") WHERE "completedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_deletion_log_subject" ON "deletion_log" ("subjectType", "subjectId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."usage_reason_enum" AS ENUM('MONTHLY_BUDGET_GRANT', 'CONSUMER_GENERATION', 'TEST_RENDER', 'ADMIN_ADJUSTMENT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "usage_ledger" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "delta" integer NOT NULL, "reason" "public"."usage_reason_enum" NOT NULL, "period" character(7) NOT NULL, "jobId" uuid, "userId" uuid, "balanceAfter" integer NOT NULL, "actorId" uuid, "note" character varying(255), CONSTRAINT "PK_6fc3c8ac6eced66d0a08665aa4f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_ledger_actorId" ON "usage_ledger" ("actorId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_usage_ledger_userId" ON "usage_ledger" ("userId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_usage_ledger_job" ON "usage_ledger" ("jobId") WHERE "jobId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_usage_ledger_period_createdAt" ON "usage_ledger" ("period", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."quota_reason_enum" AS ENUM('MONTHLY_GRANT', 'OVERRIDE_GRANT', 'GENERATION_CONSUMED', 'ADMIN_ADJUSTMENT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "quota_ledger" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "delta" integer NOT NULL, "reason" "public"."quota_reason_enum" NOT NULL, "period" character(7) NOT NULL, "jobId" uuid, "actorId" uuid, "note" character varying(255), CONSTRAINT "PK_be0a7370ac5385a608b91886606" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_quota_ledger_actorId" ON "quota_ledger" ("actorId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_quota_ledger_job" ON "quota_ledger" ("jobId") WHERE "jobId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_quota_ledger_userId_period" ON "quota_ledger" ("userId", "period") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_channel_enum" AS ENUM('EMAIL', 'SMS', 'IN_APP')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notification_status_enum" AS ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications_outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "channel" "public"."notification_channel_enum" NOT NULL, "template" character varying(80) NOT NULL, "locale" "public"."locale_enum" NOT NULL, "recipientUserId" uuid, "recipientAddress" character varying(320), "payload" jsonb NOT NULL, "status" "public"."notification_status_enum" NOT NULL DEFAULT 'PENDING', "attempts" integer NOT NULL DEFAULT '0', "availableAt" TIMESTAMP WITH TIME ZONE NOT NULL, "sentAt" TIMESTAMP WITH TIME ZONE, "readAt" TIMESTAMP WITH TIME ZONE, "lastError" character varying(512), "dedupeKey" character varying(160), CONSTRAINT "PK_25647b9aa150108580a3c2d00d3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_notifications_outbox_dedupe" ON "notifications_outbox" ("dedupeKey") WHERE "dedupeKey" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_outbox_recipient_read" ON "notifications_outbox" ("recipientUserId", "readAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_notifications_outbox_status_availableAt" ON "notifications_outbox" ("status", "availableAt") WHERE "status" = 'PENDING'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."moderation_source_enum" AS ENUM('UPSTREAM', 'HEURISTIC', 'MANUAL_REPORT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."moderation_state_enum" AS ENUM('PENDING', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "moderation_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "personPhotoId" uuid, "userId" uuid, "jobId" uuid, "source" "public"."moderation_source_enum" NOT NULL, "reasonCode" character varying(64) NOT NULL, "state" "public"."moderation_state_enum" NOT NULL DEFAULT 'PENDING', "blurredThumbnailKey" character varying(512), "reviewedBy" uuid, "reviewedAt" TIMESTAMP WITH TIME ZONE, "decisionNote" text, CONSTRAINT "PK_7553314431cdb0fe119568d0f22" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_moderation_items_reviewedBy" ON "moderation_items" ("reviewedBy") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_moderation_items_jobId" ON "moderation_items" ("jobId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_moderation_items_personPhotoId" ON "moderation_items" ("personPhotoId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_moderation_items_photo_pending" ON "moderation_items" ("personPhotoId") WHERE "state" = 'PENDING' AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_moderation_items_userId" ON "moderation_items" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_moderation_items_state_createdAt" ON "moderation_items" ("state", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ip_blocks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "cidr" cidr NOT NULL, "reason" character varying(255) NOT NULL, "createdBy" uuid, "expiresAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5721684b9a271a5acd05633a453" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_ip_blocks_createdBy" ON "ip_blocks" ("createdBy") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ip_blocks_cidr" ON "ip_blocks" ("cidr") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "invites" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "email" character varying(320) NOT NULL, "role" "public"."role_enum" NOT NULL, "tokenHash" character(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "invitedBy" uuid NOT NULL, "consumedByUserId" uuid, CONSTRAINT "PK_aa52e96b44a714372f4dd31a0af" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_invites_consumedByUserId" ON "invites" ("consumedByUserId") `,
    );
    await queryRunner.query(`CREATE INDEX "IDX_invites_invitedBy" ON "invites" ("invitedBy") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_invites_email_pending" ON "invites" ("email") WHERE "consumedAt" IS NULL AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_invites_tokenHash" ON "invites" ("tokenHash") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "garment_images" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "garmentId" uuid NOT NULL, "storageKey" character varying(512) NOT NULL, "thumbnailKey" character varying(512), "isTryOnSource" boolean NOT NULL DEFAULT false, "hash" character(64) NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "byteSize" integer NOT NULL, "mimeType" character varying(64) NOT NULL, "position" integer NOT NULL DEFAULT '0', "altText" character varying(255), CONSTRAINT "PK_0fbb3ef8fab9b1f80d4a7fb49f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_garment_images_hash" ON "garment_images" ("hash") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_garment_images_source" ON "garment_images" ("garmentId") WHERE "isTryOnSource" = true AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_garment_images_garmentId_position" ON "garment_images" ("garmentId", "position") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."enquiry_status_enum" AS ENUM('NEW', 'CONTACTED', 'IN_DISCUSSION', 'CLOSED_WON', 'CLOSED_LOST')`,
    );
    await queryRunner.query(
      `CREATE TABLE "enquiries" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "reference" character varying(20) NOT NULL, "userId" uuid NOT NULL, "message" text NOT NULL, "status" "public"."enquiry_status_enum" NOT NULL DEFAULT 'NEW', "lostReason" text, "eventDate" date, "eventType" "public"."event_type_enum", "budgetBand" "public"."budget_band_enum", "contactName" character varying(120) NOT NULL, "contactEmail" character varying(320) NOT NULL, "contactPhone" character varying(24) NOT NULL, "firstRespondedAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, "assignedTo" uuid, "totalValueSnapshot" numeric(18,2), CONSTRAINT "PK_1516c8a887df94dc119a1db749e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiries_assignedTo" ON "enquiries" ("assignedTo") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiries_firstRespondedAt" ON "enquiries" ("firstRespondedAt") WHERE "firstRespondedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiries_userId_createdAt" ON "enquiries" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiries_status_createdAt" ON "enquiries" ("status", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_enquiries_reference" ON "enquiries" ("reference") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "enquiry_notes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "enquiryId" uuid NOT NULL, "authorId" uuid, "body" text NOT NULL, CONSTRAINT "PK_37dbe1e32053750520cfa9a472e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiry_notes_authorId" ON "enquiry_notes" ("authorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiry_notes_enquiryId_createdAt" ON "enquiry_notes" ("enquiryId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "enquiry_items" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "enquiryId" uuid NOT NULL, "garmentId" uuid, "resultId" uuid, "rank" integer NOT NULL, "note" text, "garmentTitleSnapshot" character varying(160) NOT NULL, "garmentSkuSnapshot" character varying(64) NOT NULL, "garmentPriceSnapshot" numeric(18,2), CONSTRAINT "PK_94643978174177cefaff95aba8a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiry_items_resultId" ON "enquiry_items" ("resultId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_enquiry_items_garmentId" ON "enquiry_items" ("garmentId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_enquiry_items_enquiry_rank" ON "enquiry_items" ("enquiryId", "rank") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "policy_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" character varying(20) NOT NULL, "effectiveFrom" TIMESTAMP WITH TIME ZONE NOT NULL, "isCurrent" boolean NOT NULL DEFAULT false, "bodyEn" text NOT NULL, "bodyUr" text NOT NULL, "summaryEn" text NOT NULL, "summaryUr" text NOT NULL, "retentionSummary" jsonb NOT NULL, CONSTRAINT "PK_125d2970fc66a316f84af16812e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_policy_versions_current" ON "policy_versions" ("isCurrent") WHERE "isCurrent" = true AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_policy_versions_version" ON "policy_versions" ("version") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "consents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "userId" uuid NOT NULL, "policyVersionId" uuid NOT NULL, "policyVersion" character varying(20) NOT NULL, "grantedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "ip" inet NOT NULL, "userAgent" character varying(512) NOT NULL, "locale" "public"."locale_enum" NOT NULL, CONSTRAINT "PK_9efc68eb6aba7d638fb6ea034dd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_consents_policyVersionId" ON "consents" ("policyVersionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_consents_userId_createdAt" ON "consents" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."verification_purpose_enum" AS ENUM('EMAIL_VERIFICATION', 'PASSWORD_RESET', 'PHONE_OTP', 'INVITE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "verification_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid, "purpose" "public"."verification_purpose_enum" NOT NULL, "tokenHash" character(64) NOT NULL, "codeHash" character(64), "destination" character varying(320) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "consumedAt" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', "ip" inet, CONSTRAINT "PK_f2d4d7a2aa57ef199e61567db22" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_tokens_expiresAt" ON "verification_tokens" ("expiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_tokens_userId_purpose" ON "verification_tokens" ("userId", "purpose") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_verification_tokens_tokenHash" ON "verification_tokens" ("tokenHash") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "userId" uuid NOT NULL, "tokenHash" character(64) NOT NULL, "csrfSecret" character(64) NOT NULL, "role" "public"."role_enum" NOT NULL, "ip" inet NOT NULL, "userAgent" character varying(512), "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "absoluteExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "twofaPending" boolean NOT NULL DEFAULT false, "twofaVerifiedAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "revokedReason" character varying(64), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_sessions_expiresAt" ON "sessions" ("expiresAt") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sessions_userId_revokedAt" ON "sessions" ("userId", "revokedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_sessions_tokenHash" ON "sessions" ("tokenHash") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."auth_outcome_enum" AS ENUM('SUCCESS', 'INVALID_CREDENTIALS', 'LOCKED', 'TWOFA_FAILED', 'RATE_LIMITED', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_attempts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "emailHash" character(64) NOT NULL, "userId" uuid, "ip" inet NOT NULL, "userAgent" character varying(512), "outcome" "public"."auth_outcome_enum" NOT NULL, "route" character varying(64) NOT NULL, CONSTRAINT "PK_d9115e02f18808834eb82b4a297" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_attempts_userId" ON "auth_attempts" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_attempts_outcome_createdAt" ON "auth_attempts" ("outcome", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_attempts_ip_createdAt" ON "auth_attempts" ("ip", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_attempts_emailHash_createdAt" ON "auth_attempts" ("emailHash", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_log" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actorId" uuid, "actorRole" "public"."role_enum", "action" character varying(80) NOT NULL, "targetType" character varying(60) NOT NULL, "targetId" uuid, "targetLabel" character varying(160), "metadata" jsonb NOT NULL DEFAULT '{}', "ip" inet, "userAgent" character varying(512), "requestId" uuid, CONSTRAINT "PK_07fefa57f7f5ab8fc3f52b3ed0b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_target" ON "audit_log" ("targetType", "targetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_action_createdAt" ON "audit_log" ("action", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_actorId_createdAt" ON "audit_log" ("actorId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_51dbc5eb6b6072bf1b06fea8d84" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consumer_profiles" ADD CONSTRAINT "FK_a4a26cde310b21650c253c3b7c0" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" ADD CONSTRAINT "FK_9a6f051e66982b5f0318981bcaa" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" ADD CONSTRAINT "FK_5993194a125475b97d1e2ae43a5" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" ADD CONSTRAINT "FK_e207e2222a8f4ec25e8d07a8d40" FOREIGN KEY ("testRenderId") REFERENCES "tryon_results"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" ADD CONSTRAINT "FK_9f859fee1fedc408c887d840081" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" ADD CONSTRAINT "FK_1163030090e24a599b656a7e384" FOREIGN KEY ("qualityOverriddenBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "person_photos" ADD CONSTRAINT "FK_c2732ff9cb060ec10d78a0497a2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" ADD CONSTRAINT "FK_3108c774e4c753e6ad289838f8f" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" ADD CONSTRAINT "FK_5e00bd84e9ef9f180c20f715fdf" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" ADD CONSTRAINT "FK_3d34b0801a745c089d2d48ada75" FOREIGN KEY ("personPhotoId") REFERENCES "person_photos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" ADD CONSTRAINT "FK_33fb381bf7f1814467bf02441aa" FOREIGN KEY ("referenceModelId") REFERENCES "reference_models"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_cache" ADD CONSTRAINT "FK_12099b1b41f2c0f408409ae053e" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" ADD CONSTRAINT "FK_0d6c98fe0271ce4216e51576eb9" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" ADD CONSTRAINT "FK_60823becda06b771624c45a328c" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" ADD CONSTRAINT "FK_15da731836f6083762cfebf4859" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" ADD CONSTRAINT "FK_3f98d117d5099a5efee919648a9" FOREIGN KEY ("personPhotoId") REFERENCES "person_photos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shortlist_items" ADD CONSTRAINT "FK_83108a996549ccb8645f9ed3932" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shortlist_items" ADD CONSTRAINT "FK_751ec4d8bdfa3816b5853c1cb38" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shortlist_items" ADD CONSTRAINT "FK_5aabda7fcb379e6858cefb9da37" FOREIGN KEY ("latestResultId") REFERENCES "tryon_results"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "share_links" ADD CONSTRAINT "FK_b08daad6a2ac8038c35ab788bb2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "votes" ADD CONSTRAINT "FK_32dcdd46bf2f0b162065e38b900" FOREIGN KEY ("shareLinkId") REFERENCES "share_links"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "votes" ADD CONSTRAINT "FK_4ab4a3149d21bc88305adf7d13f" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "settings" ADD CONSTRAINT "FK_e081a6cf2fa857fbbef9c3d5554" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_log" ADD CONSTRAINT "FK_cd1b0eb0b9cf2d67e7ec400fd54" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_log" ADD CONSTRAINT "FK_2c26b575d93e6f50bc989fc263c" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_ledger" ADD CONSTRAINT "FK_6328107a19a266a8714fa6f0085" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_ledger" ADD CONSTRAINT "FK_fc05c1ef3de4aed722754a82743" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_ledger" ADD CONSTRAINT "FK_d45f3eefec87c8c7143193b055a" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "quota_ledger" ADD CONSTRAINT "FK_d5c9ae8946e0b937874af6ea707" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "quota_ledger" ADD CONSTRAINT "FK_d04dcfc52e457a0b53d78839b37" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "quota_ledger" ADD CONSTRAINT "FK_239a19cd20de99581d4e1a0c516" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications_outbox" ADD CONSTRAINT "FK_151b8e977c57279f87e4ff5469b" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" ADD CONSTRAINT "FK_ceb9a71eeaa4367d2ccbb49dea8" FOREIGN KEY ("personPhotoId") REFERENCES "person_photos"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" ADD CONSTRAINT "FK_cc45c58349cd5896b8fce4daa01" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" ADD CONSTRAINT "FK_30fe55b2d4d3e079fa39d88a649" FOREIGN KEY ("jobId") REFERENCES "tryon_jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" ADD CONSTRAINT "FK_e13c38aa51c2a92640e5669a642" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ip_blocks" ADD CONSTRAINT "FK_433b2e6915279669d5d274f7342" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invites" ADD CONSTRAINT "FK_3e3a9f6a48aaa62ec27b89fa2ed" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invites" ADD CONSTRAINT "FK_3502f594062e5e413f4c953ea52" FOREIGN KEY ("consumedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "garment_images" ADD CONSTRAINT "FK_7a0d91e4cbfa2d4d9fd87bd5439" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiries" ADD CONSTRAINT "FK_75c7ed461ab43658772e0819ebc" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiries" ADD CONSTRAINT "FK_62fe0144dde450fe647b5e6a4df" FOREIGN KEY ("assignedTo") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_notes" ADD CONSTRAINT "FK_84942385e046057a1d5bad7a2d3" FOREIGN KEY ("enquiryId") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_notes" ADD CONSTRAINT "FK_f04d7dfd456bf36a2a2920167eb" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_items" ADD CONSTRAINT "FK_590aa3b0a292755d67141783cb7" FOREIGN KEY ("enquiryId") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_items" ADD CONSTRAINT "FK_54050bbf441adde43f1a474747f" FOREIGN KEY ("garmentId") REFERENCES "garments"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_items" ADD CONSTRAINT "FK_ab5cc598f334f1f602313498286" FOREIGN KEY ("resultId") REFERENCES "tryon_results"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consents" ADD CONSTRAINT "FK_7736e32000c01e8e189d1d4a0dd" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "consents" ADD CONSTRAINT "FK_c39265052464231fc0056bb40d5" FOREIGN KEY ("policyVersionId") REFERENCES "policy_versions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" ADD CONSTRAINT "FK_8eb720a87e85b20fdfc69c38269" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_57de40bc620f456c7311aa3a1e6" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_attempts" ADD CONSTRAINT "FK_08ddee089265f4d70afc375440a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "FK_cb6aa6f6fd56f08eafb60316225" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_log" DROP CONSTRAINT "FK_cb6aa6f6fd56f08eafb60316225"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_attempts" DROP CONSTRAINT "FK_08ddee089265f4d70afc375440a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_57de40bc620f456c7311aa3a1e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "verification_tokens" DROP CONSTRAINT "FK_8eb720a87e85b20fdfc69c38269"`,
    );
    await queryRunner.query(
      `ALTER TABLE "consents" DROP CONSTRAINT "FK_c39265052464231fc0056bb40d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "consents" DROP CONSTRAINT "FK_7736e32000c01e8e189d1d4a0dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_items" DROP CONSTRAINT "FK_ab5cc598f334f1f602313498286"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_items" DROP CONSTRAINT "FK_54050bbf441adde43f1a474747f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_items" DROP CONSTRAINT "FK_590aa3b0a292755d67141783cb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_notes" DROP CONSTRAINT "FK_f04d7dfd456bf36a2a2920167eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiry_notes" DROP CONSTRAINT "FK_84942385e046057a1d5bad7a2d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiries" DROP CONSTRAINT "FK_62fe0144dde450fe647b5e6a4df"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enquiries" DROP CONSTRAINT "FK_75c7ed461ab43658772e0819ebc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "garment_images" DROP CONSTRAINT "FK_7a0d91e4cbfa2d4d9fd87bd5439"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invites" DROP CONSTRAINT "FK_3502f594062e5e413f4c953ea52"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invites" DROP CONSTRAINT "FK_3e3a9f6a48aaa62ec27b89fa2ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ip_blocks" DROP CONSTRAINT "FK_433b2e6915279669d5d274f7342"`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" DROP CONSTRAINT "FK_e13c38aa51c2a92640e5669a642"`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" DROP CONSTRAINT "FK_30fe55b2d4d3e079fa39d88a649"`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" DROP CONSTRAINT "FK_cc45c58349cd5896b8fce4daa01"`,
    );
    await queryRunner.query(
      `ALTER TABLE "moderation_items" DROP CONSTRAINT "FK_ceb9a71eeaa4367d2ccbb49dea8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications_outbox" DROP CONSTRAINT "FK_151b8e977c57279f87e4ff5469b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quota_ledger" DROP CONSTRAINT "FK_239a19cd20de99581d4e1a0c516"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quota_ledger" DROP CONSTRAINT "FK_d04dcfc52e457a0b53d78839b37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "quota_ledger" DROP CONSTRAINT "FK_d5c9ae8946e0b937874af6ea707"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_ledger" DROP CONSTRAINT "FK_d45f3eefec87c8c7143193b055a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_ledger" DROP CONSTRAINT "FK_fc05c1ef3de4aed722754a82743"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_ledger" DROP CONSTRAINT "FK_6328107a19a266a8714fa6f0085"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_log" DROP CONSTRAINT "FK_2c26b575d93e6f50bc989fc263c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deletion_log" DROP CONSTRAINT "FK_cd1b0eb0b9cf2d67e7ec400fd54"`,
    );
    await queryRunner.query(
      `ALTER TABLE "settings" DROP CONSTRAINT "FK_e081a6cf2fa857fbbef9c3d5554"`,
    );
    await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "FK_4ab4a3149d21bc88305adf7d13f"`);
    await queryRunner.query(`ALTER TABLE "votes" DROP CONSTRAINT "FK_32dcdd46bf2f0b162065e38b900"`);
    await queryRunner.query(
      `ALTER TABLE "share_links" DROP CONSTRAINT "FK_b08daad6a2ac8038c35ab788bb2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shortlist_items" DROP CONSTRAINT "FK_5aabda7fcb379e6858cefb9da37"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shortlist_items" DROP CONSTRAINT "FK_751ec4d8bdfa3816b5853c1cb38"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shortlist_items" DROP CONSTRAINT "FK_83108a996549ccb8645f9ed3932"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" DROP CONSTRAINT "FK_3f98d117d5099a5efee919648a9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" DROP CONSTRAINT "FK_15da731836f6083762cfebf4859"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" DROP CONSTRAINT "FK_60823becda06b771624c45a328c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_results" DROP CONSTRAINT "FK_0d6c98fe0271ce4216e51576eb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_cache" DROP CONSTRAINT "FK_12099b1b41f2c0f408409ae053e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" DROP CONSTRAINT "FK_33fb381bf7f1814467bf02441aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" DROP CONSTRAINT "FK_3d34b0801a745c089d2d48ada75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" DROP CONSTRAINT "FK_5e00bd84e9ef9f180c20f715fdf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tryon_jobs" DROP CONSTRAINT "FK_3108c774e4c753e6ad289838f8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "person_photos" DROP CONSTRAINT "FK_c2732ff9cb060ec10d78a0497a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" DROP CONSTRAINT "FK_1163030090e24a599b656a7e384"`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" DROP CONSTRAINT "FK_9f859fee1fedc408c887d840081"`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" DROP CONSTRAINT "FK_e207e2222a8f4ec25e8d07a8d40"`,
    );
    await queryRunner.query(
      `ALTER TABLE "garments" DROP CONSTRAINT "FK_5993194a125475b97d1e2ae43a5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "categories" DROP CONSTRAINT "FK_9a6f051e66982b5f0318981bcaa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "consumer_profiles" DROP CONSTRAINT "FK_a4a26cde310b21650c253c3b7c0"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_51dbc5eb6b6072bf1b06fea8d84"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_actorId_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_action_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_audit_log_target"`);
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_attempts_emailHash_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_attempts_ip_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_attempts_outcome_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_auth_attempts_userId"`);
    await queryRunner.query(`DROP TABLE "auth_attempts"`);
    await queryRunner.query(`DROP TYPE "public"."auth_outcome_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_sessions_tokenHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_sessions_userId_revokedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_sessions_expiresAt"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_verification_tokens_tokenHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_verification_tokens_userId_purpose"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_verification_tokens_expiresAt"`);
    await queryRunner.query(`DROP TABLE "verification_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."verification_purpose_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_consents_userId_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_consents_policyVersionId"`);
    await queryRunner.query(`DROP TABLE "consents"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_policy_versions_version"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_policy_versions_current"`);
    await queryRunner.query(`DROP TABLE "policy_versions"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_enquiry_items_enquiry_rank"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiry_items_garmentId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiry_items_resultId"`);
    await queryRunner.query(`DROP TABLE "enquiry_items"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiry_notes_enquiryId_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiry_notes_authorId"`);
    await queryRunner.query(`DROP TABLE "enquiry_notes"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_enquiries_reference"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiries_status_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiries_userId_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiries_firstRespondedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_enquiries_assignedTo"`);
    await queryRunner.query(`DROP TABLE "enquiries"`);
    await queryRunner.query(`DROP TYPE "public"."enquiry_status_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garment_images_garmentId_position"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_garment_images_source"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garment_images_hash"`);
    await queryRunner.query(`DROP TABLE "garment_images"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_invites_tokenHash"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_invites_email_pending"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_invites_invitedBy"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_invites_consumedByUserId"`);
    await queryRunner.query(`DROP TABLE "invites"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_ip_blocks_cidr"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ip_blocks_createdBy"`);
    await queryRunner.query(`DROP TABLE "ip_blocks"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_moderation_items_state_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_moderation_items_userId"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_moderation_items_photo_pending"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_moderation_items_personPhotoId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_moderation_items_jobId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_moderation_items_reviewedBy"`);
    await queryRunner.query(`DROP TABLE "moderation_items"`);
    await queryRunner.query(`DROP TYPE "public"."moderation_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."moderation_source_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_outbox_status_availableAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notifications_outbox_recipient_read"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_notifications_outbox_dedupe"`);
    await queryRunner.query(`DROP TABLE "notifications_outbox"`);
    await queryRunner.query(`DROP TYPE "public"."notification_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."notification_channel_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_quota_ledger_userId_period"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_quota_ledger_job"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_quota_ledger_actorId"`);
    await queryRunner.query(`DROP TABLE "quota_ledger"`);
    await queryRunner.query(`DROP TYPE "public"."quota_reason_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_usage_ledger_period_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_usage_ledger_job"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_usage_ledger_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_usage_ledger_actorId"`);
    await queryRunner.query(`DROP TABLE "usage_ledger"`);
    await queryRunner.query(`DROP TYPE "public"."usage_reason_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_deletion_log_subject"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_deletion_log_completedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_deletion_log_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_deletion_log_actorId"`);
    await queryRunner.query(`DROP TABLE "deletion_log"`);
    await queryRunner.query(`DROP TYPE "public"."deletion_initiator_enum"`);
    await queryRunner.query(`DROP TYPE "public"."deletion_subject_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_settings_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_settings_updatedBy"`);
    await queryRunner.query(`DROP TABLE "settings"`);
    await queryRunner.query(`DROP TYPE "public"."settings_value_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_votes_link_voter_garment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_votes_shareLinkId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_votes_garmentId"`);
    await queryRunner.query(`DROP TABLE "votes"`);
    await queryRunner.query(`DROP TYPE "public"."reaction_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_share_links_tokenHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_share_links_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_share_links_expiresAt"`);
    await queryRunner.query(`DROP TABLE "share_links"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_shortlist_items_user_garment"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_shortlist_items_userId_rank"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_shortlist_items_garmentId_verdict"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_shortlist_items_latestResultId"`);
    await queryRunner.query(`DROP TABLE "shortlist_items"`);
    await queryRunner.query(`DROP TYPE "public"."reject_reason_enum"`);
    await queryRunner.query(`DROP TYPE "public"."verdict_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_results_userId_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_results_userId_garmentId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_results_personPhotoId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_results_cacheKey"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_results_jobId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_results_garmentId"`);
    await queryRunner.query(`DROP TABLE "tryon_results"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_tryon_cache_cacheKey"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_cache_personPhotoHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_cache_garmentId"`);
    await queryRunner.query(`DROP TABLE "tryon_cache"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_tryon_jobs_idem"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_jobs_userId_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_jobs_status_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_jobs_batchId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_jobs_garmentId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_jobs_personPhotoId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tryon_jobs_referenceModelId"`);
    await queryRunner.query(`DROP TABLE "tryon_jobs"`);
    await queryRunner.query(`DROP TYPE "public"."job_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."job_origin_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_reference_models_default"`);
    await queryRunner.query(`DROP TABLE "reference_models"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_person_photos_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_person_photos_userId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_person_photos_purgeAfter"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_person_photos_hash"`);
    await queryRunner.query(`DROP TABLE "person_photos"`);
    await queryRunner.query(`DROP TYPE "public"."photo_moderation_state_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_garments_sku"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_garments_slug"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_publishState_categoryId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_publishState_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_testRenderState"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_flaggedForReview"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_categoryId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_testRenderId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_approvedBy"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_garments_qualityOverriddenBy"`);
    await queryRunner.query(`DROP TABLE "garments"`);
    await queryRunner.query(`DROP TYPE "public"."test_render_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."publish_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."garment_mode_enum"`);
    await queryRunner.query(`DROP TYPE "public"."embellishment_weight_enum"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_categories_slug"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_categories_parentId_position"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_categories_archived"`);
    await queryRunner.query(`DROP TABLE "categories"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_consumer_profiles_userId"`);
    await queryRunner.query(`DROP TABLE "consumer_profiles"`);
    await queryRunner.query(`DROP TYPE "public"."budget_band_enum"`);
    await queryRunner.query(`DROP TYPE "public"."event_type_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_role_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_lastActiveAt"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_users_phone"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_users_invitedBy"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."locale_enum"`);
    await queryRunner.query(`DROP TYPE "public"."user_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."role_enum"`);
  }
}
