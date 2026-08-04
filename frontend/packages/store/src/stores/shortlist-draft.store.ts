/**
 * Optimistic shortlist ordering — PRD C-32 and D-18, ARCHITECTURE.md §6.5
 * (`useShortlistDraftStore`).
 *
 * She drags a piece up her shortlist and it moves *immediately*; `POST /shortlist/reorder` catches
 * up afterwards. That is the whole job of this store: hold the optimistic order during the drag
 * and for the round trip, and **roll it back cleanly on failure** (D-18) — which needs the order
 * that was on screen before the drag started, so both are kept.
 *
 * Not persisted. A draft order that outlives the page would silently contradict the server's rank
 * on the next load, and the rollback baseline would be meaningless.
 *
 * The list itself is server state and lives under `queryKeys.shortlist.list()`. This store holds
 * ids and nothing else.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { withDevtools } from '../middleware/devtools.middleware';

export interface ShortlistDraftState {
  /** The optimistic order while a drag or its round trip is in flight; `null` when idle. */
  pendingOrder: string[] | null;
  /** The order to restore if the server rejects the reorder (D-18). */
  baselineOrder: string[] | null;
  /** True between `commitStart` and `commitSettled`, so the UI can disable a second drag. */
  isSyncing: boolean;

  /** Called on drag start with the order currently on screen. */
  beginReorder: (currentOrder: string[]) => void;
  /** Called on every drop; replaces the optimistic order. */
  setPendingOrder: (order: string[]) => void;
  /** Convenience for a single move, so a consumer never re-implements the splice. */
  moveItem: (fromIndex: number, toIndex: number) => void;
  /** The mutation has been fired. */
  commitStart: () => void;
  /** The server accepted the order — the optimistic state is now the truth and can be dropped. */
  commitSuccess: () => void;
  /** The server rejected it — restore the baseline and clear the draft (D-18). */
  rollback: () => void;
  /** Drops all draft state without touching anything else. */
  reset: () => void;
}

const initialState = {
  pendingOrder: null,
  baselineOrder: null,
  isSyncing: false,
} satisfies Pick<ShortlistDraftState, 'pendingOrder' | 'baselineOrder' | 'isSyncing'>;

/** Pure, exported for its own test: moving an item within an array without mutating it. */
export function moveWithin<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  if (fromIndex < 0 || fromIndex >= next.length) return next;

  const clampedTo = Math.max(0, Math.min(toIndex, next.length - 1));
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return next;

  next.splice(clampedTo, 0, moved);
  return next;
}

export const useShortlistDraftStore = create<ShortlistDraftState>()(
  withDevtools(
    (set, get) => ({
      ...initialState,

      beginReorder: (currentOrder) =>
        set(
          { pendingOrder: [...currentOrder], baselineOrder: [...currentOrder], isSyncing: false },
          false,
          'shortlistDraft/beginReorder',
        ),

      setPendingOrder: (order) =>
        set({ pendingOrder: [...order] }, false, 'shortlistDraft/setPendingOrder'),

      moveItem: (fromIndex, toIndex) => {
        const { pendingOrder } = get();
        if (pendingOrder === null) return;
        set(
          { pendingOrder: moveWithin(pendingOrder, fromIndex, toIndex) },
          false,
          'shortlistDraft/moveItem',
        );
      },

      commitStart: () => set({ isSyncing: true }, false, 'shortlistDraft/commitStart'),

      commitSuccess: () => set({ ...initialState }, false, 'shortlistDraft/commitSuccess'),

      rollback: () =>
        set(
          (state) => ({
            pendingOrder: state.baselineOrder === null ? null : [...state.baselineOrder],
            baselineOrder: null,
            isSyncing: false,
          }),
          false,
          'shortlistDraft/rollback',
        ),

      reset: () => set({ ...initialState }, false, 'shortlistDraft/reset'),
    }),
    'shortlist-draft',
  ),
);

/* ------------------------------------------------------------------- selectors */

export const selectPendingShortlistOrder = (state: ShortlistDraftState): string[] | null =>
  state.pendingOrder;

export const selectIsShortlistReordering = (state: ShortlistDraftState): boolean =>
  state.pendingOrder !== null;

export const selectIsShortlistSyncing = (state: ShortlistDraftState): boolean => state.isSyncing;

export const usePendingShortlistOrder = (): string[] | null =>
  useShortlistDraftStore(selectPendingShortlistOrder);

export const useIsShortlistReordering = (): boolean =>
  useShortlistDraftStore(selectIsShortlistReordering);

export const useIsShortlistSyncing = (): boolean =>
  useShortlistDraftStore(selectIsShortlistSyncing);

/**
 * The order to render: the optimistic one while a drag is in flight, otherwise the server's.
 * Keeps the "which list do I show?" decision in one place instead of in every consumer.
 */
export function useDisplayShortlistOrder(serverOrder: readonly string[]): readonly string[] {
  const pendingOrder = usePendingShortlistOrder();
  return pendingOrder ?? serverOrder;
}

export const useShortlistDraftActions = (): Pick<
  ShortlistDraftState,
  'beginReorder' | 'setPendingOrder' | 'moveItem' | 'commitStart' | 'commitSuccess' | 'rollback' | 'reset'
> =>
  useShortlistDraftStore(
    useShallow((state) => ({
      beginReorder: state.beginReorder,
      setPendingOrder: state.setPendingOrder,
      moveItem: state.moveItem,
      commitStart: state.commitStart,
      commitSuccess: state.commitSuccess,
      rollback: state.rollback,
      reset: state.reset,
    })),
  );
