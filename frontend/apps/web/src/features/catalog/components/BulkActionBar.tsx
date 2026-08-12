'use client';

import { Archive, EyeOff, FolderInput, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Toolbar, ToolbarSeparator, ToolbarSpacer } from '@repo/ui';

import type { GarmentBulkAction } from '@/features/catalog/types/admin-catalog';

/**
 * The record operations of A-12, one API call each. Bulk test renders left with the test-render
 * workflow (2026-08): a piece is published the moment it is created, so there is nothing for a
 * render batch to gate.
 */
export type BulkOperation = GarmentBulkAction;

export interface BulkActionBarProps {
  selectedCount: number;
  maxForRecords: number;
  onRun: (operation: BulkOperation) => void;
  onClear: () => void;
  busy: boolean;
}

/**
 * The bulk bar docks to the bottom of the viewport when a selection exists (§6.2).
 *
 * `Toolbar` is one tab stop with arrow-key movement inside it: reaching the bar takes one Tab
 * rather than six, which is the difference between a usable and an unusable action bar for the
 * repetitive work D-19 is about.
 *
 * Nothing here runs on click. Every operation opens a confirmation that names what it will
 * affect (D-17).
 */
export function BulkActionBar({
  selectedCount,
  maxForRecords,
  onRun,
  onClear,
  busy,
}: BulkActionBarProps) {
  const t = useTranslations('admin.catalog.bulk');

  if (selectedCount === 0) return null;

  const overRecordCap = selectedCount > maxForRecords;

  return (
    <Toolbar variant="bulk" aria-label={t('barLabel')}>
      <p className="text-sm font-semibold text-ink" role="status" aria-live="polite">
        {t('selected', { count: selectedCount })}
      </p>

      <ToolbarSeparator />

      <Button
        size="sm"
        variant="secondary"
        disabled={busy || overRecordCap}
        startIcon={<Upload aria-hidden="true" className="size-4" />}
        onClick={() => onRun('PUBLISH')}
      >
        {t('publish')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || overRecordCap}
        startIcon={<EyeOff aria-hidden="true" className="size-4" />}
        onClick={() => onRun('UNPUBLISH')}
      >
        {t('unpublish')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || overRecordCap}
        startIcon={<FolderInput aria-hidden="true" className="size-4" />}
        onClick={() => onRun('RECATEGORISE')}
      >
        {t('recategorise')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || overRecordCap}
        startIcon={<Archive aria-hidden="true" className="size-4" />}
        onClick={() => onRun('ARCHIVE')}
      >
        {t('archive')}
      </Button>

      {/* On a phone the bar wraps, and a cap warning squeezed into the tail of a wrapped row is
          unreadable. It takes its own line below `sm` and sits inline from there (D-9). */}
      {overRecordCap ? (
        <p className="text-xs text-ink-muted max-sm:basis-full">
          {t('overRecordCap', { max: maxForRecords })}
        </p>
      ) : null}

      <ToolbarSpacer />

      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        startIcon={<X aria-hidden="true" className="size-4" />}
      >
        {t('clear')}
      </Button>
    </Toolbar>
  );
}
