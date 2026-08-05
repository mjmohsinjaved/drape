'use client';

import { useEffect } from 'react';

import { useUiStore } from '@repo/store';

/**
 * Keyboard shortcuts for the admin console — D-19.
 *
 * The full inventory (§6.2) is: `j`/`k` move between rows, `Enter` opens, `a` approves a test
 * render, `p` publishes, `/` focuses search. The row-scoped four belong to the data table that
 * owns the selection, so they are registered by that component when it lands.
 *
 * This provider owns only the two that are global:
 *   `/`  → open search
 *   `?`  → open the shortcut reference
 *
 * TODO(W3): register `j`/`k`/`Enter`/`a`/`p` from the admin `DataTable` once it exists, using
 * the same guard below so typing in a field never triggers a shortcut.
 *
 * Shortcuts never fire while the user is typing, and never while a modifier is held — a
 * shortcut that steals a keystroke mid-sentence is worse than no shortcut.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;

  // Radix renders a select, a combobox and a checkbox as `<button role="…">`, none of which
  // match a tag-name check. They all consume typed characters themselves — a Radix select
  // type-aheads to an option on `/` — so a shortcut firing over them steals the keystroke.
  const role = target.getAttribute('role');
  return role === 'combobox' || role === 'listbox' || role === 'searchbox' || role === 'textbox';
}

export function AdminShortcuts() {
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === '/') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCommandPaletteOpen]);

  return null;
}
