import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@api/modules/users/entities/user.entity';

import { RetentionPolicy } from './services/retention-policy.service';

/**
 * The §9.3 retention policy, on its own, so it can be imported without the machinery
 * that acts on it.
 *
 * `RetentionModule` deliberately exports nothing — a service reachable from there would
 * be a second way to delete an account that skipped the `deletion_log` row. But
 * `PersonPhotosService` has to write `purgeAfter` at upload, and the number it writes has
 * to be the number the purge cron will later recompute. Before this module the two read
 * `PHOTO_RETENTION_DAYS` independently and disagreed about a nonsense value.
 *
 * So the *policy* is exported and the *execution* is not. {@link RetentionPolicy} reads a
 * setting and does arithmetic; it holds no storage handle, no `deletion_log` repository
 * and no way to remove anything.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [RetentionPolicy],
  exports: [RetentionPolicy],
})
export class RetentionPolicyModule {}
