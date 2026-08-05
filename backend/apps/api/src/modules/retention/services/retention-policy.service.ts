import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MILLISECONDS_PER_DAY } from '@library/common';

import { User } from '@api/modules/users/entities/user.entity';

import { DEFAULT_PHOTO_RETENTION_DAYS } from '../constants/retention.constants';

/**
 * What §4.16's `COALESCE(u."lastActiveAt", u."createdAt")` needs from an account.
 *
 * An account with no `lastActiveAt` at all — signed up, never returned — is dated from
 * `createdAt`. The alternative is a photograph with no expiry, which is the one outcome
 * §9.3 does not permit.
 */
export interface RetentionAnchor {
  readonly lastActiveAt: Date | null;
  readonly createdAt: Date;
}

/** The instant §9.3 measures the retention window from. */
export function retentionAnchorOf(anchor: RetentionAnchor): Date {
  return anchor.lastActiveAt ?? anchor.createdAt;
}

/**
 * The policy as a pure function — §9.3, §4.16.
 *
 * `PurgeService.recomputePurgeDates()` expresses the same rule in SQL because it has to
 * run over a whole table at once; this is that rule in TypeScript, so a test can state
 * what "30 days after last account activity" means without a database. It takes the
 * whole anchor, not just `lastActiveAt`, because the SQL applies a `COALESCE` and a pure
 * twin that quietly dropped the fallback would agree with the query on every row *except*
 * the one where the fallback matters.
 */
export function purgeDateFor(anchor: RetentionAnchor, retentionDays: number): Date {
  return new Date(retentionAnchorOf(anchor).getTime() + retentionDays * MILLISECONDS_PER_DAY);
}

/**
 * **The one place `PHOTO_RETENTION_DAYS` is read and interpreted — §9.3, §4.16, C-38.**
 *
 * It used to be read in two: `PurgeService` validated the value and clamped a nonsense
 * one back to 30 days, while `PersonPhotosService` took whatever the environment said and
 * multiplied by it. Set `PHOTO_RETENTION_DAYS=0` and the two disagreed about the meaning
 * of the very same variable — the cron kept photographs for a month while every newly
 * uploaded row was written with `purgeAfter` already in the past and was collected on the
 * first nightly run. A retention policy that depends on which class you ask is not a
 * policy, so there is now exactly one class to ask.
 *
 * Validation belongs here rather than in `env.validation.ts` alone because the number is
 * also **interpolated into SQL** by the recompute: it is proved to be a positive integer
 * at the point of use, every time, not once at boot.
 */
@Injectable()
export class RetentionPolicy {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * `PHOTO_RETENTION_DAYS`, or the §7 default when it is absent or nonsense.
   *
   * A zero, a negative or a fractional value is not a shorter retention window an
   * operator chose — it is a misconfiguration, and honouring it would delete photographs
   * the consumer was told would be kept. Falling back is the safe reading; the value is
   * also interpolated into SQL, so it must be an integer before it is a literal.
   */
  retentionDays(): number {
    const configured = this.config.get<number>('PHOTO_RETENTION_DAYS');
    const days = configured ?? DEFAULT_PHOTO_RETENTION_DAYS;
    return Number.isInteger(days) && days > 0 ? days : DEFAULT_PHOTO_RETENTION_DAYS;
  }

  /** `COALESCE(lastActiveAt, createdAt) + PHOTO_RETENTION_DAYS`, validated. */
  purgeDateFor(anchor: RetentionAnchor): Date {
    return purgeDateFor(anchor, this.retentionDays());
  }

  /**
   * The same answer for an account id — the form the upload path needs.
   *
   * `lastActiveAt` is stamped at most once a minute (`SessionResolverService.recordActivity`),
   * so it is *near* "now" during an authenticated upload but not equal to it. Reading the
   * column rather than substituting `Date.now()` is what makes the value written at upload
   * the same value the nightly recompute derives — otherwise every new photograph is a row
   * the cron has to correct on its next run.
   *
   * A missing account falls back to `now`: the caller is mid-request on behalf of that
   * account, so there is no correct earlier anchor, and a photograph with no expiry is not
   * an option.
   */
  async purgeDateForUser(userId: string, now: Date = new Date()): Promise<Date> {
    const account = await this.users.findOne({
      where: { id: userId },
      select: { id: true, createdAt: true, lastActiveAt: true },
    });
    return this.purgeDateFor({
      lastActiveAt: account?.lastActiveAt ?? null,
      createdAt: account?.createdAt ?? now,
    });
  }
}
