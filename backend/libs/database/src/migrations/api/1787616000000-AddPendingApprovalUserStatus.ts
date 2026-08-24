import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddPendingApprovalUserStatus1787616000000 implements MigrationInterface {
  name = 'AddPendingApprovalUserStatus1787616000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_status_enum_new" AS ENUM('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" TYPE "public"."user_status_enum_new" USING "status"::text::"public"."user_status_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."user_status_enum_new" RENAME TO "user_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"public"."user_status_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_status_enum_old" AS ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED')`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "status" = 'SUSPENDED', "suspendedReason" = COALESCE("suspendedReason", 'Awaiting approval when admin approval was rolled back'), "suspendedAt" = COALESCE("suspendedAt", now()) WHERE "status" = 'PENDING_APPROVAL'`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" TYPE "public"."user_status_enum_old" USING "status"::text::"public"."user_status_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."user_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."user_status_enum_old" RENAME TO "user_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"public"."user_status_enum"`,
    );
  }
}
