'use client';

import * as React from 'react';

import { useTranslations } from 'next-intl';

import {
  OPENAI_IMAGE_QUALITIES,
  isApiError,
  type TryOnDriver,
  type OpenAiImageQuality,
  type TryOnProviderOption,
} from '@repo/api-client';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  RadioGroup,
  RadioGroupOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@repo/ui';

import { DeniedState, EmptyNotice, SavedIndicator, ScreenError } from '@/components/states';
import {
  isDriverNotConfigured,
  useSelectTryOnProvider,
  useTryOnProviders,
} from '@/features/tryon-provider/hooks/use-tryon-provider';

import type { Locale } from '@/i18n/config';

export interface TryOnProviderCardProps {
  locale: Locale;
}

export function TryOnProviderCard({ locale }: TryOnProviderCardProps): React.JSX.Element {
  const t = useTranslations('admin.settings.tryonProvider');

  const { data, isPending, isError, error } = useTryOnProviders();
  const switchProvider = useSelectTryOnProvider();

  const [pending, setPending] = React.useState<TryOnProviderOption | null>(null);
  const [quality, setQuality] = React.useState<OpenAiImageQuality | null>(null);
  const [justSaved, setJustSaved] = React.useState(false);

  const effectiveQuality: OpenAiImageQuality = quality ?? data?.quality ?? 'medium';

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-20 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError && isApiError(error) && error.errorCode === 'FORBIDDEN') {
    return <DeniedState locale={locale} />;
  }

  if (isError || data === undefined) {
    return (
      <ScreenError
        title={t('errors.loadTitle')}
        description={t('errors.loadBody')}
        requestId={isApiError(error) ? error.requestId : undefined}
        retryable
        size="inline"
        headingLevel="h3"
      />
    );
  }

  if (data.providers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyNotice title={t('empty.title')} description={t('empty.body')} />
        </CardContent>
      </Card>
    );
  }

  const active = data.providers.find((option) => option.active);

  function onPick(driver: string): void {
    const option = data?.providers.find((candidate) => candidate.driver === driver);
    if (option === undefined || option.active || !option.configured || !option.selectable) {
      return;
    }
    setJustSaved(false);
    setPending(option);
  }

  async function onConfirm(): Promise<void> {
    if (pending === null) {
      return;
    }
    const driver: TryOnDriver = pending.driver;
    await switchProvider
      .mutateAsync({ driver, quality: effectiveQuality })
      .then(() => {
        setPending(null);
        setQuality(null);
        setJustSaved(true);
      })
      .catch(() => undefined);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-ink-muted">
          {data.followingEnvironment
            ? t('source.environment', { driver: active?.label ?? data.active })
            : t('source.override', { driver: active?.label ?? data.active })}
        </p>

        {justSaved ? <SavedIndicator label={t('saved', { driver: active?.label ?? '' })} /> : null}

        {switchProvider.isError ? (
          <Callout
            tone="danger"
            title={
              isDriverNotConfigured(switchProvider.error)
                ? t('errors.notConfiguredTitle')
                : t('errors.switchTitle')
            }
          >
            {isDriverNotConfigured(switchProvider.error)
              ? t('errors.notConfiguredBody')
              : t('errors.switchBody')}
          </Callout>
        ) : null}

        <RadioGroup
          value={data.active}
          onValueChange={onPick}
          aria-label={t('title')}
          disabled={switchProvider.isPending}
        >
          {data.providers.map((option) => (
            <RadioGroupOption
              key={option.driver}
              card
              value={option.driver}
              disabled={!option.configured || !option.selectable || switchProvider.isPending}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {option.label}
                  {option.active ? <Badge variant="success">{t('badges.live')}</Badge> : null}
                  {option.bootDefault ? (
                    <Badge variant="neutral">{t('badges.default')}</Badge>
                  ) : null}
                  {option.billable ? <Badge variant="warning">{t('badges.billable')}</Badge> : null}
                  {!option.configured ? (
                    <Badge variant="neutral">{t('badges.notConfigured')}</Badge>
                  ) : null}
                  {!option.selectable ? (
                    <Badge variant="danger">{t('badges.notSelectable')}</Badge>
                  ) : null}
                </span>
              }
              description={
                <span className="flex flex-col gap-2">
                  <span>{option.description}</span>
                  {!option.selectable ? (
                    <span className="text-danger">{t('notSelectableHint')}</span>
                  ) : null}
                  {!option.configured ? (
                    <span className="text-ink-muted">{t('notConfiguredHint')}</span>
                  ) : null}
                  {option.driver === 'openai' && option.configured ? (
                    <span className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs font-medium text-ink">{t('quality.label')}</span>
                      <Select
                        value={effectiveQuality}
                        onValueChange={(value) => setQuality(value as OpenAiImageQuality)}
                        disabled={switchProvider.isPending}
                      >
                        <SelectTrigger className="w-40" aria-label={t('quality.label')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPENAI_IMAGE_QUALITIES.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`quality.options.${value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {option.active && quality !== null && quality !== data.quality ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={switchProvider.isPending}
                          onClick={() => {
                            void switchProvider
                              .mutateAsync({ driver: 'openai', quality })
                              .then(() => {
                                setQuality(null);
                                setJustSaved(true);
                              })
                              .catch(() => undefined);
                          }}
                        >
                          {t('quality.save')}
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              }
            />
          ))}
        </RadioGroup>
      </CardContent>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
          }
        }}
        title={t('confirm.title', { driver: pending?.label ?? '' })}
        description={
          pending?.billable
            ? t('confirm.billableBody', { driver: pending.label })
            : t('confirm.mockBody')
        }
        confirmLabel={t('confirm.action')}
        tone="primary"
        loading={switchProvider.isPending}
        onConfirm={onConfirm}
      />
    </Card>
  );
}
