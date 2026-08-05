import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '@library/database';

import { User } from '@api/modules/users/entities/user.entity';

import { SettingsValueType } from '../enums/settings-value-type.enum';

/**
 * ARCHITECTURE §4.28 — `settings`.
 *
 * The key registry lives in `shared/constants/settings-keys.constant.ts` and is
 * closed — an unknown key is `SETTINGS_KEY_UNKNOWN`.
 */
@Index('UQ_settings_key', ['key'], { unique: true, where: '"deletedAt" IS NULL' })
@Index('IDX_settings_updatedBy', ['updatedBy'])
@Entity('settings')
export class Setting extends BaseEntity {
  @Column({ type: 'varchar', length: 80 })
  key: string;

  /**
   * Nullable because "not configured yet" is a real state for several keys, not an
   * error: `brand.logoKey`, `brand.whatsappNumber`, `brand.instagramHandle` and
   * `brand.contactEmail` all ship with `defaultValue: null` in the registry, and a
   * brand that has not uploaded a logo has no value to store. `SettingsService`
   * already reads these as `?? null`; only the column disagreed, which made the
   * seeder fail on a not-null violation and left a fresh install with no settings.
   */
  @Column({ type: 'jsonb', nullable: true })
  value: unknown;

  @Column({
    type: 'enum',
    enum: SettingsValueType,
    enumName: 'settings_value_type_enum',
  })
  valueType: SettingsValueType;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  /** Exposed by `GET /settings/brand`. */
  @Column({ type: 'boolean', default: false })
  isPublic: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updatedBy' })
  updater: User | null;
}
