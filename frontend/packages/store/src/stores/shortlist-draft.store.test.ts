import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ShortlistDraftState,
  moveWithin,
  selectIsShortlistReordering,
  selectIsShortlistSyncing,
  selectPendingShortlistOrder,
  useShortlistDraftStore,
} from './shortlist-draft.store';

function state(): ShortlistDraftState {
  return useShortlistDraftStore.getState();
}

const SERVER_ORDER = ['a', 'b', 'c', 'd'];

describe('moveWithin', () => {
  it('moves an item forward and backward without mutating the input', () => {
    const source = [...SERVER_ORDER];

    expect(moveWithin(source, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveWithin(source, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(source).toEqual(SERVER_ORDER);
  });

  it('is a no-op when the item is dropped where it started', () => {
    expect(moveWithin(SERVER_ORDER, 1, 1)).toEqual(SERVER_ORDER);
  });

  it('clamps an out-of-range target instead of losing the item', () => {
    expect(moveWithin(SERVER_ORDER, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveWithin(SERVER_ORDER, 2, -5)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('ignores an out-of-range source', () => {
    expect(moveWithin(SERVER_ORDER, 9, 0)).toEqual(SERVER_ORDER);
    expect(moveWithin([], 0, 0)).toEqual([]);
  });
});

describe('useShortlistDraftStore — the C-32 / D-18 optimistic cycle', () => {
  beforeEach(() => {
    state().reset();
  });

  it('is idle to start with, so the server order renders unchanged', () => {
    expect(state().pendingOrder).toBeNull();
    expect(state().baselineOrder).toBeNull();
    expect(state().isSyncing).toBe(false);
  });

  it('beginReorder snapshots the on-screen order as both draft and rollback baseline', () => {
    state().beginReorder(SERVER_ORDER);

    expect(state().pendingOrder).toEqual(SERVER_ORDER);
    expect(state().baselineOrder).toEqual(SERVER_ORDER);
    // Copies, not references — a later mutation of the caller's array must not leak in.
    expect(state().pendingOrder).not.toBe(SERVER_ORDER);
    expect(state().baselineOrder).not.toBe(state().pendingOrder);
  });

  it('moveItem updates the draft and leaves the baseline alone', () => {
    state().beginReorder(SERVER_ORDER);
    state().moveItem(0, 2);

    expect(state().pendingOrder).toEqual(['b', 'c', 'a', 'd']);
    expect(state().baselineOrder).toEqual(SERVER_ORDER);
  });

  it('moveItem does nothing before a drag has begun', () => {
    state().moveItem(0, 2);
    expect(state().pendingOrder).toBeNull();
  });

  it('setPendingOrder replaces the draft outright', () => {
    state().beginReorder(SERVER_ORDER);
    state().setPendingOrder(['d', 'c', 'b', 'a']);

    expect(state().pendingOrder).toEqual(['d', 'c', 'b', 'a']);
  });

  it('commitSuccess drops the draft — the server order is now the truth', () => {
    state().beginReorder(SERVER_ORDER);
    state().moveItem(0, 3);
    state().commitStart();
    expect(state().isSyncing).toBe(true);

    state().commitSuccess();

    expect(state().pendingOrder).toBeNull();
    expect(state().baselineOrder).toBeNull();
    expect(state().isSyncing).toBe(false);
  });

  it('rollback restores exactly what was on screen before the drag (D-18)', () => {
    state().beginReorder(SERVER_ORDER);
    state().moveItem(0, 3);
    state().commitStart();

    state().rollback();

    expect(state().pendingOrder).toEqual(SERVER_ORDER);
    expect(state().baselineOrder).toBeNull();
    expect(state().isSyncing).toBe(false);
  });

  it('rollback with no baseline clears the draft rather than restoring nonsense', () => {
    state().setPendingOrder(['x', 'y']);
    state().rollback();

    expect(state().pendingOrder).toBeNull();
  });

  it('reset clears everything', () => {
    state().beginReorder(SERVER_ORDER);
    state().commitStart();
    state().reset();

    expect(state().pendingOrder).toBeNull();
    expect(state().baselineOrder).toBeNull();
    expect(state().isSyncing).toBe(false);
  });
});

describe('useShortlistDraftStore — selectors', () => {
  beforeEach(() => {
    state().reset();
  });

  it('reports whether a reorder is in progress', () => {
    expect(selectIsShortlistReordering(state())).toBe(false);
    expect(selectPendingShortlistOrder(state())).toBeNull();

    state().beginReorder(SERVER_ORDER);
    expect(selectIsShortlistReordering(state())).toBe(true);
    expect(selectPendingShortlistOrder(state())).toEqual(SERVER_ORDER);
  });

  it('reports whether the mutation is in flight', () => {
    expect(selectIsShortlistSyncing(state())).toBe(false);

    state().beginReorder(SERVER_ORDER);
    state().commitStart();
    expect(selectIsShortlistSyncing(state())).toBe(true);
  });
});
