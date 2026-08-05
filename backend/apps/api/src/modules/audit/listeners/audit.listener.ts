import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AUDIT_RECORD_EVENT, AuditRecordEvent } from '../events/audit.event';
import { AuditService } from '../services/audit.service';

/**
 * ARCHITECTURE §2.9 rule 4 — "audit rows (A-3) are written by an `@OnEvent` listener
 * in the `audit` module, not inline in each service."
 *
 * This is that listener, and it is the reason no other feature module needs to
 * import `AuditService`: a module that wants to be audited emits
 * {@link AUDIT_RECORD_EVENT} and carries on.
 *
 * `async: true` puts the write on the microtask queue rather than in the emitter's
 * synchronous path, so a slow insert never lengthens the request that caused it, and
 * `recordSafely()` guarantees a failed insert cannot surface as an unhandled
 * rejection.
 */
@Injectable()
export class AuditListener {
  constructor(private readonly audit: AuditService) {}

  @OnEvent(AUDIT_RECORD_EVENT, { async: true })
  async handleAuditRecord(event: AuditRecordEvent): Promise<void> {
    await this.audit.recordSafely(event.input);
  }
}
