import { type MigrationInterface, type QueryRunner } from 'typeorm';

/**
 * Removes two-factor sign-in. A password is now the only credential.
 *
 * ### What is dropped
 *
 * `users.twofaSecret`, `users.twofaEnabledAt`, `users.twofaRecoveryCodes` and the two
 * `sessions` columns that carried a half-finished login, `twofaPending` and
 * `twofaVerifiedAt`.
 *
 * ### What is deliberately *not* dropped
 *
 * `auth_outcome_enum` keeps its `TWOFA_FAILED` label. `auth_attempts` is append-only
 * (§4.7): rows written before this migration legitimately carry that outcome, and
 * removing a PostgreSQL enum label means recreating the type, which in turn means
 * rewriting those rows to an outcome that never happened. The label survives as
 * history; nothing writes it any more. `auth_attempts.route` is a plain `varchar(64)`
 * with no constraint, so its retired `'TWOFA'` values need no schema change either.
 *
 * ### On `down()`
 *
 * The columns come back with their original types, nullability and defaults, so the
 * schema is restored exactly. The **data** in them is not: dropping a column discards
 * it. Rolling this back leaves every account with no enrolled secret and every session
 * not pending — which is the correct resting state for a deployment that has been
 * running without a second factor, but it does mean the rollback is not a time machine.
 */
export class RemoveTwoFactorAuth1786100000000 implements MigrationInterface {
  /** Recorded in `api_migrations`; see the note in `InitialSchema1785943830311`. */
  name = 'RemoveTwoFactorAuth1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "twofaVerifiedAt"`);
    await queryRunner.query(`ALTER TABLE "sessions" DROP COLUMN "twofaPending"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twofaRecoveryCodes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twofaEnabledAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "twofaSecret"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "twofaSecret" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twofaEnabledAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "twofaRecoveryCodes" text array`);
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "twofaPending" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD "twofaVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }
}
