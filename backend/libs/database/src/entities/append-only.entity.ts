// libs/database/src/entities/append-only.entity.ts
import { BaseEntity as TypeOrmBaseEntity, CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Base for immutable ledgers and records of fact: quota_ledger, usage_ledger,
 * audit_log, consents, deletion_log, enquiry_notes, auth_attempts.
 *
 * There is no updatedAt and no deletedAt — by design. Rows are INSERTed and read.
 * Never call save() on a loaded instance, never softRemove(), never remove().
 * Correcting a mistake means appending a compensating row, not editing history.
 */
export abstract class AppendOnlyEntity extends TypeOrmBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
