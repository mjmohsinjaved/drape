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

import {
  MAX_SUSPENSION_REASON_LENGTH,
  MIN_SUSPENSION_REASON_LENGTH,
} from '@/features/consumers/types/admin-consumers';

export interface SuspendConsumerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consumerName: string;
  onConfirm: (reason: string) => Promise<void>;
  saving: boolean;
  errorMessage?: string | null;
}

export function SuspendConsumerDialog({
  open,
  onOpenChange,
  consumerName,
  onConfirm,
  saving,
  errorMessage,
}: SuspendConsumerDialogProps) {
  const t = useTranslations('admin.consumers.suspend');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_SUSPENSION_REASON_LENGTH;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('title', { name: consumerName })}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <Callout tone="warning" title={t('consequenceTitle')}>
            <ul className="flex list-disc flex-col gap-1 ps-4">
              <li>{t('consequenceSignedOut')}</li>
              <li>{t('consequenceBlocked')}</li>
              <li>{t('consequenceEmailed')}</li>
              <li>{t('consequenceDataKept')}</li>
            </ul>
          </Callout>

          <FormField required>
            <FormLabel>{t('reasonLabel')}</FormLabel>
            <FormControl>
              <Textarea
                value={reason}
                rows={3}
                maxLength={MAX_SUSPENSION_REASON_LENGTH}
                onBlur={() => setTouched(true)}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t('reasonPlaceholder')}
              />
            </FormControl>
            <FormHint>{t('reasonHint', { min: MIN_SUSPENSION_REASON_LENGTH })}</FormHint>
            <FormError>{touched && tooShort ? t('reasonTooShort') : undefined}</FormError>
          </FormField>

          {errorMessage != null ? <Callout tone="danger">{errorMessage}</Callout> : null}
        </DialogBody>

        <DialogFooter>
          {/* Cancel carries the primary weight: not suspending is the safer outcome. */}
          <Button variant="primary" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button
            variant="secondary"
            disabled={tooShort || saving}
            loading={saving}
            loadingLabel={t('confirming')}
            onClick={() => void onConfirm(trimmed)}
          >
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
