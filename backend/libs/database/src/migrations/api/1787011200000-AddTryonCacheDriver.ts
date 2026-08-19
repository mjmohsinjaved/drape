import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddTryonCacheDriver1787011200000 implements MigrationInterface {
  name = 'AddTryonCacheDriver1787011200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tryon_cache" ADD "driver" character varying(16)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tryon_cache" DROP COLUMN "driver"`);
  }
}
