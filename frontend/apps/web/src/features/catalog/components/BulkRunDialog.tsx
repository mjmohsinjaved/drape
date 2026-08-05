'use client';

import { useEffect, useMemo, useState } from 'react';

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormControl,
  FormField,
  FormHint,
  FormLabel,
  ProgressBar,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  StatusPill,
} from '@repo/ui';
import { formatCurrency } from '@repo/utils';

import { useCatalogErrorCopy } from '@/features/catalog/hooks/use-catalog-error';
import { useBulkGarments } from '@/features/catalog/hooks/use-garments';
import {
  useQueueBulkTestRender,
  useTestRenderBatch,
  useTestRenderEstimate,
} from '@/features/catalog/hooks/use-test-render';

import type { BulkOperation } from '@/features/catalog/components/BulkActionBar';
import type { AdminGarment, TestRenderEstimate } from '@/features/catalog/types/admin-catalog';
import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { Uuid } from '@repo/api-client';

export interface BulkRunDialogProps {
  operation: BulkOperation;
  garments: readonly AdminGarment[];
  categories: readonly AdminCategory[];
  onClose: () => void;
  /** Called once the run has finished, so the list can drop its selection. */
  onFinished: () => void;
}

type Phase = 'confirm' | 'running' | 'report';

interface ReportRow {
  id: Uuid;
  ok: boolean;
  code: string | null;
}

/**
 * A-12 and D-16, in one dialog with three phases.
 *
 * **Confirm.** It names what is about to be affected — the count and the first few titles, not
 * "3 items" (D-17). A test render additionally fetches its cost estimate *before* the run button
 * is live, because A-12 requires the cost to be shown and confirmed before anything is spent,
 * and because this is the only place the remaining budget appears in the flow (A-29).
 *
 * **Running.** A record bulk is one call. A test-render batch is queued and processed at
 * concurrency one, so this polls the batch and reports item by item.
 *
 * **Report.** Successes counted, failures named one by one with their own reason. Never one
 * opaque result: forty pieces where three failed is neither a success nor a failure, and D-16
 * wants the three named.
 */
export function BulkRunDialog({
  operation,
  garments,
  categories,
  onClose,
  onFinished,
}: BulkRunDialogProps) {
  const t = useTranslations('admin.catalog.bulk');
  const errorCopy = useCatalogErrorCopy();

  const garmentIds = useMemo(() => garments.map((garment) => garment.id), [garments]);
  const titleById = useMemo(
    () => new Map(garments.map((garment) => [garment.id, garment.title])),
    [garments],
  );

  const [phase, setPhase] = useState<Phase>('confirm');
  const [destinationId, setDestinationId] = useState<Uuid | ''>('');
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [batchId, setBatchId] = useState<Uuid | null>(null);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const bulkRecords = useBulkGarments();
  const estimate = useTestRenderEstimate();
  const queueBatch = useQueueBulkTestRender();
  const batch = useTestRenderBatch(batchId);

  const isTestRender = operation === 'TEST_RENDER';
  const { mutate: runEstimate } = estimate;

  // The estimate is read-only and spends nothing, so it runs as the dialog opens.
  useEffect(() => {
    if (isTestRender) runEstimate(garmentIds);
  }, [garmentIds, isTestRender, runEstimate]);

  // A queued batch finishes asynchronously; the report is drawn from its final item list.
  const batchData = batch.data;
  useEffect(() => {
    if (phase !== 'running' || !batchData || batchData.pending > 0) return;
    setReportRows(
      batchData.items.map((item) => ({
        id: item.garmentId,
        ok: item.status === 'SUCCEEDED',
        code: item.errorCode,
      })),
    );
    setPhase('report');
  }, [batchData, phase]);

  const handleRun = async (): Promise<void> => {
    setFailureMessage(null);
    setPhase('running');

    try {
      if (isTestRender) {
        const queued = await queueBatch.mutateAsync({ garmentIds });
        setBatchId(queued.batchId);
        return;
      }

      const result = await bulkRecords.mutateAsync({
        action: operation,
        garmentIds,
        ...(operation === 'RECATEGORISE' && destinationId !== ''
          ? { categoryId: destinationId }
          : {}),
      });
      setReportRows(
        result.results.map((item) => ({
          id: item.garmentId,
          ok: item.succeeded,
          code: item.errorCode,
        })),
      );
      setPhase('report');
    } catch (error: unknown) {
      setFailureMessage(errorCopy.fromError(error));
      setPhase('confirm');
    }
  };

  const canRun =
    operation === 'RECATEGORISE' ? destinationId !== '' : isTestRender ? estimate.isSuccess : true;

  const namedTitles = garments.slice(0, 3).map((garment) => garment.title);
  const remaining = garments.length - namedTitles.length;
  const selectableCategories = categories.filter((category) => !category.archived);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (next) return;
        if (phase === 'report') onFinished();
        onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t(`confirm.${operation}.title`, { count: garments.length })}</DialogTitle>
          <DialogDescription>
            {remaining > 0
              ? t('confirm.namedWithRest', { names: namedTitles.join(', '), count: remaining })
              : t('confirm.named', { names: namedTitles.join(', ') })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {phase === 'confirm' ? (
            <>
              <p className="text-sm text-ink-muted">{t(`confirm.${operation}.body`)}</p>

              {operation === 'RECATEGORISE' ? (
                <FormField required>
                  <FormLabel>{t('confirm.destination')}</FormLabel>
                  <Select value={destinationId} onValueChange={setDestinationId}>
                    {/* `FormControl` wires the trigger; the Radix root renders no DOM node. */}
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('confirm.destinationPlaceholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {selectableCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormHint>{t('confirm.destinationHint')}</FormHint>
                </FormField>
              ) : null}

              {isTestRender ? (
                <EstimatePanel
                  // `isPending` on a mutation is false until it is fired, so the panel keys off
                  // "no answer yet" instead — otherwise it renders nothing for the frame between
                  // the dialog opening and the effect below firing the estimate.
                  loading={!estimate.isSuccess && !estimate.isError}
                  errorMessage={estimate.isError ? errorCopy.fromError(estimate.error) : null}
                  estimate={estimate.data ?? null}
                />
              ) : null}

              {failureMessage !== null ? (
                <Callout tone="danger" title={t('runFailedTitle')}>
                  {failureMessage}
                </Callout>
              ) : null}
            </>
          ) : null}

          {phase === 'running' ? (
            <RunningPanel
              total={batchData?.total ?? null}
              done={batchData ? batchData.succeeded + batchData.failed : null}
              failed={batchData?.failed ?? 0}
            />
          ) : null}

          {phase === 'report' ? <ReportPanel rows={reportRows} titleById={titleById} /> : null}
        </DialogBody>

        <DialogFooter>
          {phase === 'report' ? (
            <Button
              variant="primary"
              onClick={() => {
                onFinished();
                onClose();
              }}
            >
              {t('done')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={phase === 'running'}>
                {t('cancel')}
              </Button>
              <Button
                variant={operation === 'ARCHIVE' ? 'danger' : 'primary'}
                disabled={!canRun}
                loading={phase === 'running'}
                loadingLabel={t(`confirm.${operation}.action`)}
                onClick={() => void handleRun()}
              >
                {t(`confirm.${operation}.action`)}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EstimatePanelProps {
  loading: boolean;
  errorMessage: string | null;
  estimate: TestRenderEstimate | null;
}

/** A-12 / A-29 — what the run will spend, and what is left, before it is allowed to start. */
function EstimatePanel({ loading, errorMessage, estimate }: EstimatePanelProps) {
  const t = useTranslations('admin.catalog.bulk.estimate');

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner size="sm" label={null} />
        {t('loading')}
      </p>
    );
  }

  if (errorMessage !== null) {
    return (
      <Callout tone="danger" title={t('failedTitle')}>
        {errorMessage}
      </Callout>
    );
  }

  if (!estimate) return null;

  return (
    <Callout
      tone={estimate.withinBudget ? 'info' : 'warning'}
      title={t('title', { generations: estimate.generations })}
      icon={
        estimate.withinBudget ? undefined : <AlertTriangle aria-hidden="true" className="size-4" />
      }
    >
      <ul className="flex flex-col gap-1 text-sm">
        <li>{t('selected', { count: estimate.selected })}</li>
        <li>{t('alreadyApproved', { count: estimate.alreadyApproved })}</li>
        <li>{t('budgetRemaining', { amount: formatCurrency(estimate.budgetRemaining) })}</li>
        {!estimate.withinBudget ? <li className="font-medium">{t('overBudget')}</li> : null}
      </ul>
    </Callout>
  );
}

interface RunningPanelProps {
  total: number | null;
  done: number | null;
  failed: number;
}

function RunningPanel({ total, done, failed }: RunningPanelProps) {
  const t = useTranslations('admin.catalog.bulk');

  if (total === null || done === null) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-ink-muted"
        role="status"
        aria-live="polite"
      >
        <Spinner size="sm" label={null} />
        {t('working')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ProgressBar
        value={total === 0 ? 0 : Math.round((done / total) * 100)}
        label={t('progressLabel')}
        showLabel
      />
      <p className="text-sm text-ink-muted" role="status" aria-live="polite">
        {t('progressCounts', { done, total, failed })}
      </p>
    </div>
  );
}

interface ReportPanelProps {
  rows: readonly ReportRow[];
  titleById: ReadonlyMap<Uuid, string>;
}

/** D-16 — the summary and every failure named, so nothing is hidden behind a count. */
function ReportPanel({ rows, titleById }: ReportPanelProps) {
  const t = useTranslations('admin.catalog.bulk.report');
  const errorCopy = useCatalogErrorCopy();

  const succeeded = rows.filter((row) => row.ok).length;
  const failed = rows.length - succeeded;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-ink" role="status" aria-live="polite">
        {t('summary', { succeeded, failed, total: rows.length })}
      </p>

      {failed > 0 ? (
        <Callout tone="warning" title={t('partialTitle')}>
          {t('partialBody')}
        </Callout>
      ) : null}

      <ScrollArea className="max-h-64">
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-sm border border-line p-2"
            >
              <span className="min-w-0 flex-1 text-sm text-ink">
                {titleById.get(row.id) ?? row.id}
              </span>
              {row.ok ? (
                <StatusPill size="sm" tone="success" srPrefix={t('outcome')} dot={false}>
                  <CheckCircle2 aria-hidden="true" className="size-3" />
                  {t('succeeded')}
                </StatusPill>
              ) : (
                <span className="flex flex-col items-end gap-1">
                  <StatusPill size="sm" tone="danger" srPrefix={t('outcome')} dot={false}>
                    <XCircle aria-hidden="true" className="size-3" />
                    {t('failed')}
                  </StatusPill>
                  <span className="text-xs text-ink-muted">{errorCopy.fromCode(row.code)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
