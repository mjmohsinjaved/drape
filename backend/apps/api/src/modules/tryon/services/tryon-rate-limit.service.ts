import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { MoreThanOrEqual, Repository } from 'typeorm';

import { TryOnConfig } from '../config/tryon.config';
import { TryOnJob } from '../entities/tryon-job.entity';

import type { RateWindow } from '../guards/tryon-guard.predicates';

/** One rolling hour, in milliseconds. C-6's window. */
const WINDOW_MS = 60 * 60 * 1000;

/** Ceiling on tracked IPs, so a spray of addresses cannot exhaust memory. */
const MAX_TRACKED_IPS = 20_000;

/**
 * C-6 / §5.22 — the per-account and per-IP generation ceilings **above** the monthly
 * quota, evaluated as step 7 of the §8.1 guard chain.
 *
 * These are not the `@Throttle()` on the route. That one is a 6-per-minute burst
 * guard against a stuck retry loop; these are hour-long ceilings whose job is to bound
 * what a single compromised account or a single script can cost, and they are part of
 * the spend decision rather than part of transport.
 *
 * ### Two different stores, for two different reasons
 *
 * **Per account** is counted from `tryon_jobs`. That table already records every
 * generation with a timestamp and an owner, it survives a restart, and counting rows
 * there means the limit cannot be reset by bouncing the process.
 *
 * **Per IP** is in memory. No table carries the caller's address — deliberately: an IP
 * is personal data under §9.3 and the schema keeps it only where consent (§4.11) and
 * abuse handling (§4.8) genuinely need it, never against a render. A per-process
 * sliding window is the honest trade: there is one API process in V1 (§8.2, no queue),
 * a restart forgives a window, and the account ceiling and the monthly quota are both
 * still in force underneath.
 */
@Injectable()
export class TryOnRateLimitService {
  /** ip → start timestamps inside the current window. Pruned on read and on write. */
  private readonly ipHits = new Map<string, number[]>();

  constructor(
    @InjectRepository(TryOnJob)
    private readonly jobs: Repository<TryOnJob>,
    private readonly config: TryOnConfig,
  ) {}

  /** Generations this account has started in the last hour, against `TRYON_RATE_PER_HOUR`. */
  async accountWindow(userId: string): Promise<RateWindow> {
    const since = new Date(Date.now() - WINDOW_MS);
    const used = await this.jobs.count({
      where: { userId, createdAt: MoreThanOrEqual(since) },
    });

    return {
      used,
      limit: this.config.ratePerHour,
      retryAfterSeconds: WINDOW_MS / 1000,
    };
  }

  /** Generations this address has started in the last hour, against `TRYON_RATE_PER_IP_HOUR`. */
  ipWindow(ip: string | undefined): RateWindow {
    const limit = this.config.ratePerIpHour;

    if (ip === undefined || ip.length === 0) {
      // An unattributable request is not a licence to bypass the ceiling, but it is
      // also not evidence of abuse. The account ceiling still applies.
      return { used: 0, limit, retryAfterSeconds: 0 };
    }

    const hits = this.prune(ip);
    const oldest = hits[0];

    return {
      used: hits.length,
      limit,
      retryAfterSeconds:
        oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000)),
    };
  }

  /**
   * Records that a generation started from `ip`.
   *
   * Called **after** the guard chain passes and before the upstream call, so a request
   * refused by an earlier guard never counts against the window — a consumer whose
   * consent lapsed should not also find herself rate-limited.
   */
  recordIpHit(ip: string | undefined): void {
    if (ip === undefined || ip.length === 0) {
      return;
    }
    if (!this.ipHits.has(ip) && this.ipHits.size >= MAX_TRACKED_IPS) {
      this.evictOldest();
    }
    const hits = this.prune(ip);
    hits.push(Date.now());
    this.ipHits.set(ip, hits);
  }

  /** Test seam: forget every tracked address. */
  reset(): void {
    this.ipHits.clear();
  }

  private prune(ip: string): number[] {
    const cutoff = Date.now() - WINDOW_MS;
    const hits = (this.ipHits.get(ip) ?? []).filter((at) => at > cutoff);
    if (hits.length === 0) {
      this.ipHits.delete(ip);
    } else {
      this.ipHits.set(ip, hits);
    }
    return hits;
  }

  /** Drops the least recently active address. Bounded memory beats perfect accounting. */
  private evictOldest(): void {
    let oldestIp: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;

    for (const [ip, hits] of this.ipHits) {
      const last = hits[hits.length - 1] ?? 0;
      if (last < oldestAt) {
        oldestAt = last;
        oldestIp = ip;
      }
    }

    if (oldestIp !== null) {
      this.ipHits.delete(oldestIp);
    }
  }
}
