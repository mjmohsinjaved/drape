'use client';

import { useUiStore } from '@repo/store';
import { Button, Kbd } from '@repo/ui';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';

/**
 * The admin search entry point. Shows the `/` hint so the shortcut is discoverable rather than
 * folklore (D-19).
 *
 * TODO(W3): the command palette this opens is built with the admin catalog workstream. Until
 * then the control is present, labelled and keyboard-reachable, and opens an empty palette.
 */
export function AdminSearchTrigger() {
  const t = useTranslations('admin.nav');
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 justify-start gap-2 sm:w-64"
      onClick={() => setCommandPaletteOpen(true)}
    >
      <Search aria-hidden="true" className="size-4" />
      <span className="text-ink-subtle">{t('search')}</span>
      <Kbd className="ms-auto hidden sm:inline-flex">/</Kbd>
    </Button>
  );
}
