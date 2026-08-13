'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'drape.hiddenPhotos.v1';

/** Writes the set, returning whether it stuck. Private-mode storage failures are not fatal. */
function persistHidden(next: ReadonlySet<string>): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    return true;
  } catch {
    return false;
  }
}

export function useHiddenPhotos(): {
  hidden: ReadonlySet<string>;
  toggleHidden: (photoId: string) => void;
} {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Storage is unreadable in private mode; degrade to "nothing hidden".
      setHidden(new Set());
    }
  }, []);

  const toggleHidden = useCallback((photoId: string): void => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      // Same degradation as the read: the toggle still applies for this session even when
      // it cannot be persisted, so the write is attempted and its failure is not fatal.
      persistHidden(next);
      return next;
    });
  }, []);

  return { hidden, toggleHidden };
}
