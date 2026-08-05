'use client';

import { Archive, EyeOff, FolderInput, Sparkles, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Toolbar, ToolbarSeparator, ToolbarSpacer } from '@repo/ui';

import type { GarmentBulkAction } from '@/features/catalog/types/admin-catalog';

/** The five things A-12 asks for. The first four are one API call; the fifth is a queued batch. */
export type BulkOperation = GarmentBulkAction | 'TEST_RENDER';

export interface BulkActionBarProps {
  selectedCount: number;
  /** The A-12 cap, so the bar can say the selection is too large before anything is spent. */
  maxForTestRender: number;
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
 * affect, and the test render additionally shows its cost first (A-12, D-17).
 */
export function BulkActionBar({
  selectedCount,
  maxForTestRender,
  maxForRecords,
  onRun,
  onClear,
  busy,
}: BulkActionBarProps) {
  const t = useTranslations('admin.catalog.bulk');

  if (selectedCount === 0) return null;

  const overRecordCap = selectedCount > maxForRecords;
  const overRenderCap = selectedCount > maxForTestRender;

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
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || overRenderCap}
        startIcon={<Sparkles aria-hidden="true" className="size-4" />}
        onClick={() => onRun('TEST_RENDER')}
      >
        {t('testRender')}
      </Button>

      {/* On a phone the bar wraps, and a cap warning squeezed into the tail of a wrapped row is
          unreadable. It takes its own line below `sm` and sits inline from there (D-9). */}
      {overRenderCap || overRecordCap ? (
        <p className="text-xs text-ink-muted max-sm:basis-full">
          {overRecordCap
            ? t('overRecordCap', { max: maxForRecords })
            : t('overRenderCap', { max: maxForTestRender })}
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
