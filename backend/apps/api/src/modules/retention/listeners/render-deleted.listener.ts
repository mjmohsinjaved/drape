import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '@api/modules/audit/events/audit.event';
import { TryOnResult } from '@api/modules/results/entities/tryon-result.entity';
import { TryOnCache } from '@api/modules/tryon/entities/tryon-cache.entity';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

/**
 * **The dangling `tryon_cache` pointer `modules/tryon` flagged — C-31, §3.7, §4.19.**
 *
 * ### The gap
 *
 * §3.7 makes the canonical cached render **the requesting user's own file**:
 * `tryon_cache.storageKey` is the very `renders/<userId>/<uuid>.png` that her
 * `tryon_results` row points at. `TryOnCacheService.retireByPersonPhotoHash` documents
 * this carefully and correctly for the *photo* deletion path — the row goes, the bytes
 * stay, because they belong to a live render.
 *
 * The reverse case has no owner. When she deletes an individual **render** (C-31),
 * `ResultsService.remove()` soft-deletes the row and hard-deletes the file — and the
 * `tryon_cache` row that pointed at that file survives, now pointing at bytes that no
 * longer exist. The next consumer whose photograph hashes the same gets a cache hit, a
 * copy is attempted from a missing object, and the generation fails for a reason that
 * has nothing to do with her.
 *
 * ### The fix, and its honest shape
 *
 * This mirrors `PersonPhotoRemovedListener`: a listener, in the module that can reach
 * the table, reacting to a fact rather than being called about it. One difference is
 * worth stating plainly.
 *
 * `person-photos` emits `PERSON_PHOTO_EVENTS.REMOVED`, a domain event written for the
 * purpose. **`results` emits no equivalent** — its `remove()` emits only
 * `AUDIT_RECORD_EVENT` with `TRYON_RESULT_DELETED`, and `modules/results` is not this
 * workstream's to edit. So this listens to the audit event and filters on the action.
 *
 * That is a compromise and it is worth naming: an audit event is a record that something
 * was logged, not a domain announcement, and driving behaviour from one couples this
 * listener to another module's logging rather than to its domain. It is chosen over the
 * alternatives — reaching into `results` to add an event (not this workstream's file),
 * or a periodic sweep comparing every cache row against storage (correct but eventual,
 * and it does not help the consumer whose generation fails in the meantime).
 *
 * **The one-line change that removes the compromise:** `results` adds
 * `RESULT_EVENTS.REMOVED` carrying `{ userId, resultId, cacheKey, storageKey }` and
 * emits it after the commit; this listener switches its `@OnEvent` and drops the
 * `withDeleted` re-read below. Nothing else moves.
 *
 * ### Precision: the row must point at *her* file
 *
 * The predicate is `cacheKey` **and** `storageKey` together. The §3.7 key is
 * `sha256(garmentSourceHash:personPhotoHash:TRYON_API_VERSION)`, so two consumers with
 * byte-identical photographs share a key — but the cache row names exactly one canonical
 * file. Retiring on `cacheKey` alone would drop a perfectly good row whose bytes belong
 * to somebody else and cost that person a regeneration. Matching both retires the row if
 * and only if the file it names is the one that was just deleted.
 *
 * ### Never throws
 *
 * `EventEmitterModule` runs with `ignoreErrors: false`, so a rejection escaping an async
 * listener is an unhandled rejection in a process that just served a successful
 * deletion. A failure here leaves a stale pointer — the condition that existed before
 * this listener was written — and is logged.
 */
@Injectable()
export class RenderDeletedListener {
  private readonly logger = new Logger(RenderDeletedListener.name);

  constructor(
    @InjectRepository(TryOnCache)
    private readonly cache: Repository<TryOnCache>,
    @InjectRepository(TryOnResult)
    private readonly results: Repository<TryOnResult>,
  ) {}

  /**
   * `async: true` — the retirement goes on the microtask queue rather than into the
   * emitter's synchronous path, so `DELETE /results/:resultId` never waits on it.
   */
  @OnEvent(AUDIT_RECORD_EVENT, { async: true })
  async onAuditRecord(event: AuditRecordEvent): Promise<void> {
    if (event.input.action !== AUDIT_ACTIONS.TRYON_RESULT_DELETED) {
      return;
    }

    const resultId = event.input.targetId;
    if (resultId === null || resultId === undefined) {
      return;
    }

    try {
      await this.retireFor(resultId);
    } catch (error: unknown) {
      this.logger.warn(
        'A deleted render left its cache entry in place; the next consumer to hit that key ' +
          'will get a copy failure and regenerate. ' +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Retires the cache row whose canonical object was this render's file.
   *
   * The render row is read `withDeleted` because `ResultsService.remove()` soft-deletes
   * it (C-31) — the row is still there, and it is the only thing that still knows which
   * `cacheKey` and `storageKey` the deleted file answered to.
   *
   * @returns how many rows were retired. Zero is the common, correct case: a render that
   *   was never cached, or one whose cache row names somebody else's copy.
   */
  async retireFor(resultId: string): Promise<number> {
    const render = await this.results.findOne({
      where: { id: resultId },
      withDeleted: true,
      select: { id: true, cacheKey: true, storageKey: true },
    });

    if (render === null) {
      return 0;
    }

    const result = await this.cache.delete({
      cacheKey: render.cacheKey,
      storageKey: render.storageKey,
    });
    const retired = result.affected ?? 0;

    if (retired > 0) {
      this.logger.log(
        `Retired ${retired} cache entr${retired === 1 ? 'y' : 'ies'} that pointed at a render ` +
          'the owner deleted (C-31, §3.7).',
      );
    }
    return retired;
  }
}
