'use client';

import { useEffect, useState } from 'react';

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
  FormError,
  FormField,
  FormHint,
  FormLabel,
  Textarea,
} from '@repo/ui';

import { MIN_OVERRIDE_REASON_LENGTH } from '@/features/catalog/types/admin-catalog';

export interface QualityOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  garmentTitle: string;
  score: number;
  minScore: number;
  /** How many A-10 checks the photograph is currently failing. */
  failedChecks: number;
  onConfirm: (reason: string) => Promise<void>;
  saving: boolean;
}

/**
 * A-10's override, made deliberate.
 *
 * > "…cannot be published without an explicit override, which is logged."
 *
 * The dialog states the consequence before it asks for anything: the piece goes live with a
 * photograph the try-on model is known to struggle with, consumers will see more failed
 * generations from it, and the waiver is written to the audit log under the admin's name. Only
 * then does it ask for a reason — required by the API, at least ten characters, because an audit
 * row that records a rule being bypassed and cannot say why is the one thing an audit trail
 * exists to prevent.
 *
 * The confirm button stays disabled until the reason is long enough, so the fastest way out of
 * this dialog is Cancel.
 */
export function QualityOverrideDialog({
  open,
  onOpenChange,
  garmentTitle,
  score,
  minScore,
  failedChecks,
  onConfirm,
  saving,
}: QualityOverrideDialogProps) {
  const t = useTranslations('admin.catalog.override');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const tooShort = reason.trim().length < MIN_OVERRIDE_REASON_LENGTH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('title', { title: garmentTitle })}</DialogTitle>
          <DialogDescription>{t('body', { score, minScore })}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <Callout tone="warning" title={t('consequenceTitle')}>
            <ul className="flex list-disc flex-col gap-1 ps-4">
              <li>{t('consequenceFailedChecks', { count: failedChecks })}</li>
              <li>{t('consequenceConsumers')}</li>
              <li>{t('consequenceAudit')}</li>
            </ul>
          </Callout>

          <FormField required>
            <FormLabel>{t('reasonLabel')}</FormLabel>
            <FormControl>
              <Textarea
                value={reason}
                rows={3}
                maxLength={500}
                onBlur={() => setTouched(true)}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('reasonPlaceholder')}
              />
            </FormControl>
            <FormHint>{t('reasonHint', { min: MIN_OVERRIDE_REASON_LENGTH })}</FormHint>
            <FormError>{touched && tooShort ? t('reasonTooShort') : undefined}</FormError>
          </FormField>
        </DialogBody>

        <DialogFooter>
          {/* Cancel is the primary-weight control here: not overriding is the better outcome. */}
          <Button variant="primary" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button
            variant="secondary"
            disabled={tooShort || saving}
            loading={saving}
            loadingLabel={t('confirm')}
            onClick={() => void onConfirm(reason.trim())}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
