'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { moveWithin, useShortlistDraftActions, usePendingShortlistOrder } from '@repo/store';
import { Badge, Button, Callout, IconButton, Textarea } from '@repo/ui';

import { formatMoney } from '@/features/catalog-browse/lib/format';
import {
  removeShortlistItem,
  reorderShortlist,
  updateShortlistItem,
} from '@/features/shortlist/api/endpoints';
import { useErrorMessage } from '@/features/tryon/hooks/use-error-message';
import { resolveErrorCode } from '@/features/tryon/lib/error-copy';
import { routes } from '@/lib/routes';

import type { ShortlistItem } from '@/features/shortlist/api/types';
import type { Locale } from '@/i18n/config';

export interface ShortlistBoardProps {
  locale: Locale;
  items: ShortlistItem[];
}

/**
 * Drag-to-rank, with a keyboard path that is not a lesser one — PRD C-32, D-20.
 *
 * Three ways to reorder, all producing the same result:
 *
 * 1. **Pointer drag** on the handle. Works with a mouse and with a finger, because it is built on
 *    Pointer Events and row geometry rather than HTML5 drag-and-drop, which does not fire on
 *    touch at all — and this is a mobile-first product.
 * 2. **Keyboard grab.** Space picks the row up, the arrow keys move it, Space drops it, Escape
 *    puts it back. Every transition is announced through a live region, because a reorder nobody
 *    can see is a reorder nobody can verify.
 * 3. **Move up / Move down buttons**, always visible, each with an accessible name that includes
 *    the piece. The plainest path, and the one that needs no gesture vocabulary at all.
 *
 * The order is optimistic and rolls back on failure (D-18), which is what `useShortlistDraftStore`
 * exists for: it holds the on-screen order during the round trip and the baseline to restore.
 * `POST /shortlist/reorder` takes the **whole** list — a partial payload is refused, because
 * renumbering half a list is how two rows end up sharing a position.
 */
export function ShortlistBoard({ locale, items }: ShortlistBoardProps) {
  const t = useTranslations('shortlist');
  const messageFor = useErrorMessage('shortlist');
  const router = useRouter();

  const pendingOrder = usePendingShortlistOrder();
  const { beginReorder, setPendingOrder, commitStart, commitSuccess, rollback } =
    useShortlistDraftActions();

  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const serverOrder = items.map((item) => item.id);
  const order = pendingOrder ?? serverOrder;

  // Memoised because `move` closes over it: a fresh Map on every render would rebuild the
  // callback on every render too, and with it every row's handlers.
  const byId = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const ordered = order
    .map((id) => byId.get(id))
    .filter((item): item is ShortlistItem => item !== undefined);

  const commit = useCallback(
    (nextOrder: string[]): void => {
      setPendingOrder(nextOrder);
      commitStart();
      setErrorCode(null);

      void reorderShortlist({ itemIds: nextOrder })
        .then(() => {
          commitSuccess();
          setAnnouncement(t('reorder.saved'));
          router.refresh();
        })
        .catch((error: unknown) => {
          rollback();
          setErrorCode(resolveErrorCode(error));
          setAnnouncement(t('reorder.failed'));
        });
    },
    [commitStart, commitSuccess, rollback, router, setPendingOrder, t],
  );

  const move = useCallback(
    (id: string, delta: number, announceKey: 'moved' | 'dropped'): void => {
      const from = order.indexOf(id);
      if (from < 0) return;
      const to = Math.max(0, Math.min(order.length - 1, from + delta));
      if (to === from) return;

      const next = moveWithin(order, from, to);
      const item = byId.get(id);
      setPendingOrder(next);
      setAnnouncement(
        t(`reorder.${announceKey}`, {
          garment: item?.garmentTitle ?? '',
          rank: to + 1,
          total: next.length,
        }),
      );
      commit(next);
    },
    [byId, commit, order, setPendingOrder, t],
  );

  /** Keyboard reordering. Space grabs and drops; the arrows move; Escape restores. */
  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, item: ShortlistItem): void => {
      const index = order.indexOf(item.id);

      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (grabbedId === item.id) {
          setGrabbedId(null);
          setAnnouncement(
            t('reorder.dropped', {
              garment: item.garmentTitle,
              rank: index + 1,
              total: order.length,
            }),
          );
          commit(order);
        } else {
          beginReorder(order);
          setGrabbedId(item.id);
          setAnnouncement(
            t('reorder.grabbed', {
              garment: item.garmentTitle,
              rank: index + 1,
              total: order.length,
            }),
          );
        }
        return;
      }

      if (event.key === 'Escape' && grabbedId === item.id) {
        event.preventDefault();
        rollback();
        setGrabbedId(null);
        setAnnouncement(
          t('reorder.cancelled', { garment: item.garmentTitle, rank: index + 1 }),
        );
        return;
      }

      if (grabbedId !== item.id) return;

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const from = order.indexOf(item.id);
        if (from <= 0) return;
        const next = moveWithin(order, from, from - 1);
        setPendingOrder(next);
        setAnnouncement(
          t('reorder.moved', { garment: item.garmentTitle, rank: from, total: next.length }),
        );
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const from = order.indexOf(item.id);
        if (from >= order.length - 1) return;
        const next = moveWithin(order, from, from + 1);
        setPendingOrder(next);
        setAnnouncement(
          t('reorder.moved', { garment: item.garmentTitle, rank: from + 2, total: next.length }),
        );
      }
    },
    [beginReorder, commit, grabbedId, order, rollback, setPendingOrder, t],
  );

  /**
   * Pointer drag. The row under the pointer is found from the live row rectangles rather than
   * from a drop target, so it works identically on touch, where there is no drag event at all.
   */
  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, item: ShortlistItem): void => {
      // Only a primary press starts a drag — a right-click or a second finger must not.
      if (!event.isPrimary || event.button !== 0) return;

      event.preventDefault();
      beginReorder(order);
      setDraggingId(item.id);

      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      let workingOrder = [...order];

      const onMove = (moveEvent: PointerEvent): void => {
        const from = workingOrder.indexOf(item.id);
        if (from < 0) return;

        for (const [id, element] of rowRefs.current) {
          if (id === item.id) continue;
          const rect = element.getBoundingClientRect();
          if (moveEvent.clientY < rect.top || moveEvent.clientY > rect.bottom) continue;

          const to = workingOrder.indexOf(id);
          if (to < 0 || to === from) continue;

          workingOrder = moveWithin(workingOrder, from, to);
          setPendingOrder(workingOrder);
          break;
        }
      };

      const onUp = (): void => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        setDraggingId(null);
        commit(workingOrder);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [beginReorder, commit, order, setPendingOrder],
  );

  const removeItem = useCallback(
    (item: ShortlistItem): void => {
      setErrorCode(null);
      void removeShortlistItem(item.id)
        .then(() => {
          setAnnouncement(t('list.removed'));
          router.refresh();
        })
        .catch((error: unknown) => {
          setErrorCode(resolveErrorCode(error));
        });
    },
    [router, t],
  );

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {errorCode !== null ? <Callout tone="warning">{messageFor(errorCode)}</Callout> : null}

      <p className="text-sm text-ink-subtle">{t('reorder.handleHint')}</p>

      <ol className="flex flex-col gap-4">
        {ordered.map((item, index) => (
          <li
            key={item.id}
            ref={(element) => {
              if (element === null) rowRefs.current.delete(item.id);
              else rowRefs.current.set(item.id, element);
            }}
            className={[
              'flex items-start gap-3 rounded-xl border p-3',
              grabbedId === item.id || draggingId === item.id
                ? 'border-brand bg-brand-tint'
                : 'border-line bg-surface',
            ].join(' ')}
          >
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                aria-label={t('reorder.handleLabel', { garment: item.garmentTitle })}
                aria-pressed={grabbedId === item.id}
                className="inline-flex size-11 cursor-grab touch-none items-center justify-center rounded-md text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] active:cursor-grabbing"
                onKeyDown={(event) => {
                  onHandleKeyDown(event, item);
                }}
                onPointerDown={(event) => {
                  onHandlePointerDown(event, item);
                }}
              >
                <GripVertical aria-hidden="true" className="size-5" />
              </button>

              <IconButton
                size="md"
                variant="ghost"
                label={t('reorder.moveUp', { garment: item.garmentTitle })}
                icon={<ChevronUp />}
                disabled={index === 0}
                onClick={() => {
                  move(item.id, -1, 'moved');
                }}
              />
              <IconButton
                size="md"
                variant="ghost"
                label={t('reorder.moveDown', { garment: item.garmentTitle })}
                icon={<ChevronDown />}
                disabled={index === ordered.length - 1}
                onClick={() => {
                  move(item.id, 1, 'moved');
                }}
              />
            </div>

            <ShortlistRow
              locale={locale}
              item={item}
              rank={index + 1}
              onRemove={() => {
                removeItem(item);
              }}
              onError={setErrorCode}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ShortlistRow({
  locale,
  item,
  rank,
  onRemove,
  onError,
}: {
  locale: Locale;
  item: ShortlistItem;
  rank: number;
  onRemove: () => void;
  onError: (code: string) => void;
}) {
  const t = useTranslations('shortlist');
  const router = useRouter();

  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(item.note ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const price = formatMoney(locale, item.price, item.currency);

  const saveNote = useCallback((): void => {
    setIsSaving(true);
    const next = note.trim();
    void updateShortlistItem(item.id, { note: next === '' ? null : next })
      .then(() => {
        setEditingNote(false);
        router.refresh();
      })
      .catch((error: unknown) => {
        onError(resolveErrorCode(error));
      })
      .finally(() => {
        setIsSaving(false);
      });
  }, [item.id, note, onError, router]);

  return (
    <div className="flex min-w-0 flex-1 gap-3">
      <div className="w-20 shrink-0 sm:w-24">
        {item.renderThumbnailUrl === null ? (
          <div className="flex aspect-card w-full items-center justify-center rounded-lg bg-surface-sunken px-2 text-center text-2xs text-ink-subtle">
            {t('list.noRender')}
          </div>
        ) : (
          // A signed, short-lived URL (§3.4): a plain <img>, never the image optimiser's cache.
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL.
          <img
            src={item.renderThumbnailUrl}
            alt={t('list.renderAlt', { garment: item.garmentTitle })}
            className="aspect-card w-full rounded-lg object-cover"
            loading="lazy"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-xs text-ink-subtle">{t('list.rank', { rank })}</p>
        <h3 className="text-base font-medium">{item.garmentTitle}</h3>
        {item.garmentCategory === null ? null : (
          <p className="text-sm text-ink-muted">{item.garmentCategory}</p>
        )}
        <p className="text-sm">{price ?? t('list.priceOnRequest')}</p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {item.verdict === 'NOT_FOR_ME' ? null : (
            <Badge variant={item.verdict === 'LOVE_IT' ? 'brand' : 'neutral'}>
              {t(`list.verdict.${item.verdict}`)}
            </Badge>
          )}
          {item.garmentAvailable ? null : (
            <Badge variant="outline">{t('list.unavailable')}</Badge>
          )}
        </div>

        {item.garmentAvailable ? null : (
          <p className="text-sm text-ink-muted">{t('list.unavailableHint')}</p>
        )}

        {editingNote ? (
          <div className="flex flex-col gap-2 pt-2">
            <Textarea
              value={note}
              rows={3}
              maxLength={500}
              aria-label={t('note.label', { garment: item.garmentTitle })}
              placeholder={t('note.placeholder')}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <p className="text-xs text-ink-subtle">{t('note.hint')}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                loading={isSaving}
                loadingLabel={t('note.saving')}
                onClick={saveNote}
              >
                {t('note.save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNote(item.note ?? '');
                  setEditingNote(false);
                }}
              >
                {t('note.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 pt-1">
            {item.note === null ? null : (
              <p className="text-sm text-pretty text-ink-muted">{item.note}</p>
            )}
            <Button
              type="button"
              size="sm"
              variant="link"
              className="w-fit"
              onClick={() => {
                setEditingNote(true);
              }}
            >
              {item.note === null ? t('note.add') : t('note.edit')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {item.latestResultId === null ? (
            item.garmentAvailable ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={routes.garment(locale, item.garmentId)}>{t('list.tryOn')}</Link>
              </Button>
            ) : null
          ) : (
            <Button asChild size="sm" variant="secondary">
              <Link href={routes.render(locale, item.latestResultId)}>{t('list.viewRender')}</Link>
            </Button>
          )}

          <IconButton
            size="md"
            variant="ghost"
            label={t('list.remove')}
            icon={<Trash2 />}
            onClick={onRemove}
          />
        </div>
      </div>
    </div>
  );
}
