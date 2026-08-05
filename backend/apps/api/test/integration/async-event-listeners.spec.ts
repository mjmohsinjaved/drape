import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';

import { AuditListener } from '@api/modules/audit/listeners/audit.listener';
import { EnquiryNotificationsListener } from '@api/modules/enquiries/listeners/enquiry-notifications.listener';
import { BudgetAlertListener } from '@api/modules/notifications/listeners/budget-alert.listener';
import { QuotaOverrideListener } from '@api/modules/quota/listeners/quota-override.listener';
import { RenderDeletedListener } from '@api/modules/retention/listeners/render-deleted.listener';
import { ShareNotificationsListener } from '@api/modules/share/listeners/share-notifications.listener';
import { PersonPhotoRemovedListener } from '@api/modules/tryon/listeners/person-photo-removed.listener';

/**
 * **Every `async` `@OnEvent` handler must declare `{ async: true }` — M12.**
 *
 * `EventEmitter2.emit()` is synchronous. It calls each listener and discards whatever comes
 * back, so a handler declared `async` returns a promise into nothing: the work is started,
 * never awaited, and a rejection surfaces as an unhandled rejection at best. `{ async: true }`
 * is what makes `@nestjs/event-emitter` collect the promise so `emitAsync` can await it and
 * so the module's `ignoreErrors: false` — set in `api.module.ts` — can actually report.
 *
 * Three listeners were missing it, and each one loses something a person was told had
 * happened:
 *
 *  - `EnquiryNotificationsListener` — A-25's "tell the studio" and C-35's confirmation to her;
 *  - `QuotaOverrideListener` — an A-18 quota raise the admin has already been shown as applied;
 *  - `ShareNotificationsListener` — the C-33 comment notification.
 *
 * The listeners that *did* have it (`AuditListener` and the other two below) are asserted
 * here too, because the point of this file is the invariant, not the three fixes: a listener
 * added tomorrow without the flag fails here rather than dropping a notification in
 * production.
 *
 * Read from decorator metadata rather than by emitting, because that is where the defect
 * lived — the handlers themselves were always correct.
 */

interface RegisteredListener {
  readonly event: string | symbol | (string | symbol)[];
  readonly options?: { readonly async?: boolean };
}

/** Every `@OnEvent` registration on a class, as the emitter will read them. */
function listenersOf(target: new (...args: never[]) => object): {
  method: string;
  metadata: RegisteredListener;
}[] {
  const prototype = target.prototype as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((method) => {
      const handler = prototype[method];
      if (typeof handler !== 'function') {
        return [];
      }
      const metadata = Reflect.getMetadata(EVENT_LISTENER_METADATA, handler) as
        RegisteredListener | RegisteredListener[] | undefined;

      if (metadata === undefined) {
        return [];
      }
      return (Array.isArray(metadata) ? metadata : [metadata]).map((entry) => ({
        method,
        metadata: entry,
      }));
    });
}

/** True when the method is declared `async` — the ones that need the flag. */
function isAsyncMethod(target: new (...args: never[]) => object, method: string): boolean {
  const handler = (target.prototype as Record<string, unknown>)[method];
  return typeof handler === 'function' && handler.constructor.name === 'AsyncFunction';
}

const LISTENERS: readonly [string, new (...args: never[]) => object][] = [
  ['EnquiryNotificationsListener', EnquiryNotificationsListener],
  ['QuotaOverrideListener', QuotaOverrideListener],
  ['ShareNotificationsListener', ShareNotificationsListener],
  ['AuditListener', AuditListener],
  ['BudgetAlertListener', BudgetAlertListener],
  ['PersonPhotoRemovedListener', PersonPhotoRemovedListener],
  ['RenderDeletedListener', RenderDeletedListener],
];

describe('@OnEvent listeners — an async handler is awaited or it is a dropped notification', () => {
  it.each(LISTENERS)('%s registers at least one handler', (_name, listener) => {
    expect(listenersOf(listener).length).toBeGreaterThan(0);
  });

  it.each(LISTENERS)('%s declares { async: true } on every async handler', (name, listener) => {
    const offenders = listenersOf(listener)
      .filter(({ method }) => isAsyncMethod(listener, method))
      .filter(({ metadata }) => metadata.options?.async !== true)
      .map(({ method }) => `${name}.${method}`);

    expect(offenders).toEqual([]);
  });
});
