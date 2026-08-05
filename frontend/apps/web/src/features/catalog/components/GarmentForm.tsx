'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  Button,
  Callout,
  FormControl,
  FormError,
  FormField,
  FormHint,
  FormLabel,
  Input,
  RadioGroup,
  RadioGroupOption,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TagInput,
  Textarea,
} from '@repo/ui';
import { slugify } from '@repo/utils';

import { AdminSection } from '@/features/catalog/components/AdminPage';
import {
  EMBELLISHMENT_WEIGHT_OPTIONS,
  GARMENT_LIMITS,
  GARMENT_MODE_OPTIONS,
  validateGarmentForm,
  type GarmentFormErrors,
  type GarmentFormValues,
} from '@/features/catalog/schemas/garment-form';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { EmbellishmentWeight, GarmentMode } from '@repo/api-client';

export interface GarmentFormProps {
  values: GarmentFormValues;
  onChange: (values: GarmentFormValues) => void;
  categories: readonly AdminCategory[];
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  saving: boolean;
  /** Field errors the API sent back, merged with the local ones. */
  serverErrors?: GarmentFormErrors;
  secondaryAction?: React.ReactNode;
}

/**
 * A-8 — every field the requirement names, in three groups an admin fills in one pass.
 *
 * The **deposit** is the only field with a conditional life. A-8 says "deposit if rental", so:
 * the price group asks whether the piece is a sale or a rental as two described cards; the
 * deposit field appears only under the rental card; and choosing sale states plainly that the
 * deposit will be cleared. Nothing here waits for the API to say no — §4.13 refuses a deposit on
 * a sale outright, and an interface that lets an admin type one into a form that will be
 * rejected has already wasted their time.
 */
export function GarmentForm({
  values,
  onChange,
  categories,
  onSubmit,
  submitLabel,
  saving,
  serverErrors,
  secondaryAction,
}: GarmentFormProps) {
  const t = useTranslations('admin.catalog.form');
  const [touched, setTouched] = useState(false);

  const localErrors = validateGarmentForm(values, {
    skuRequired: t('errors.skuRequired'),
    titleRequired: t('errors.titleRequired'),
    categoryRequired: t('errors.categoryRequired'),
    priceRequired: t('errors.priceRequired'),
    priceInvalid: t('errors.priceInvalid'),
    depositRequired: t('errors.depositRequired'),
    depositInvalid: t('errors.depositInvalid'),
  });

  const errors: GarmentFormErrors = { ...(touched ? localErrors : {}), ...serverErrors };
  const set = <K extends keyof GarmentFormValues>(key: K, value: GarmentFormValues[K]): void => {
    onChange({ ...values, [key]: value });
  };

  const handleModeChange = (mode: GarmentMode): void => {
    // Clearing the deposit here rather than on save is what makes the rule visible: the field
    // disappears and its value goes with it, in the same gesture.
    onChange({ ...values, mode, deposit: mode === 'SALE' ? '' : values.deposit });
  };

  const selectable = categories.filter((category) => !category.archived);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (Object.keys(localErrors).length > 0) return;
        void onSubmit();
      }}
      className="flex flex-col gap-stack"
    >
      <AdminSection title={t('identity.title')} description={t('identity.description')}>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField required>
            <FormLabel>{t('fields.title')}</FormLabel>
            <FormControl>
              <Input
                value={values.title}
                maxLength={GARMENT_LIMITS.title}
                onChange={(event) => set('title', event.target.value)}
                placeholder={t('placeholders.title')}
              />
            </FormControl>
            <FormHint>{t('hints.title')}</FormHint>
            <FormError>{errors.title}</FormError>
          </FormField>

          <FormField>
            <FormLabel>{t('fields.titleUr')}</FormLabel>
            <FormControl>
              <Input
                value={values.titleUr}
                lang="ur"
                dir="rtl"
                maxLength={GARMENT_LIMITS.title}
                onChange={(event) => set('titleUr', event.target.value)}
              />
            </FormControl>
            <FormHint>{t('hints.titleUr')}</FormHint>
          </FormField>

          <FormField required>
            <FormLabel>{t('fields.sku')}</FormLabel>
            <FormControl>
              <Input
                value={values.sku}
                maxLength={GARMENT_LIMITS.sku}
                onChange={(event) => set('sku', event.target.value)}
                placeholder={t('placeholders.sku')}
                className="font-mono"
              />
            </FormControl>
            <FormHint>{t('hints.sku')}</FormHint>
            <FormError>{errors.sku}</FormError>
          </FormField>

          <FormField>
            <FormLabel>{t('fields.slug')}</FormLabel>
            <FormControl>
              <Input
                value={values.slug}
                onChange={(event) => set('slug', event.target.value)}
                onBlur={() => {
                  if (values.slug.trim() === '') set('slug', slugify(values.title));
                }}
                className="font-mono"
              />
            </FormControl>
            <FormHint>{t('hints.slug')}</FormHint>
          </FormField>

          <FormField required>
            <FormLabel>{t('fields.category')}</FormLabel>
            <Select
              value={values.categoryId === '' ? undefined : values.categoryId}
              onValueChange={(value) => set('categoryId', value)}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t('placeholders.category')} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {selectable.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.parentId === null ? category.name : `— ${category.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormHint>{t('hints.category')}</FormHint>
            <FormError>{errors.categoryId}</FormError>
          </FormField>
        </div>
      </AdminSection>

      <AdminSection title={t('detail.title')} description={t('detail.description')}>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField>
            <FormLabel>{t('fields.colors')}</FormLabel>
            <TagInput
              value={values.colors}
              onValueChange={(next) => set('colors', next)}
              maxTags={GARMENT_LIMITS.colors}
              label={t('fields.colors')}
              placeholder={t('placeholders.colors')}
              removeLabel={(tag) => t('removeTag', { tag })}
            />
            <FormHint>{t('hints.colors')}</FormHint>
          </FormField>

          <FormField>
            <FormLabel>{t('fields.fabric')}</FormLabel>
            <FormControl>
              <Input
                value={values.fabric}
                maxLength={GARMENT_LIMITS.fabric}
                onChange={(event) => set('fabric', event.target.value)}
                placeholder={t('placeholders.fabric')}
              />
            </FormControl>
          </FormField>

          <FormField>
            <FormLabel>{t('fields.sizes')}</FormLabel>
            <TagInput
              value={values.sizes}
              onValueChange={(next) => set('sizes', next)}
              maxTags={GARMENT_LIMITS.sizes}
              label={t('fields.sizes')}
              placeholder={t('placeholders.sizes')}
              removeLabel={(tag) => t('removeTag', { tag })}
            />
            <FormHint>{t('hints.sizes')}</FormHint>
          </FormField>

          <FormField>
            <FormLabel>{t('fields.styleTags')}</FormLabel>
            <TagInput
              value={values.styleTags}
              onValueChange={(next) => set('styleTags', next)}
              maxTags={GARMENT_LIMITS.styleTags}
              label={t('fields.styleTags')}
              placeholder={t('placeholders.styleTags')}
              removeLabel={(tag) => t('removeTag', { tag })}
            />
            <FormHint>{t('hints.styleTags')}</FormHint>
          </FormField>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">{t('fields.embellishment')}</legend>
          <p className="text-xs text-ink-muted">{t('hints.embellishment')}</p>
          <RadioGroup
            value={values.embellishmentWeight}
            onValueChange={(value) => set('embellishmentWeight', value as EmbellishmentWeight)}
            className="grid gap-2 sm:grid-cols-3"
          >
            {EMBELLISHMENT_WEIGHT_OPTIONS.map((weight) => (
              <RadioGroupOption
                key={weight}
                value={weight}
                card
                label={t(`embellishment.${weight}.label`)}
                description={t(`embellishment.${weight}.description`)}
              />
            ))}
          </RadioGroup>
        </fieldset>

        <FormField>
          <FormLabel>{t('fields.description')}</FormLabel>
          <FormControl>
            <Textarea
              value={values.description}
              maxLength={GARMENT_LIMITS.description}
              rows={4}
              onChange={(event) => set('description', event.target.value)}
              placeholder={t('placeholders.description')}
            />
          </FormControl>
          <FormHint>{t('hints.description')}</FormHint>
        </FormField>

        <FormField>
          <FormLabel>{t('fields.descriptionUr')}</FormLabel>
          <FormControl>
            <Textarea
              value={values.descriptionUr}
              lang="ur"
              dir="rtl"
              maxLength={GARMENT_LIMITS.description}
              rows={4}
              onChange={(event) => set('descriptionUr', event.target.value)}
            />
          </FormControl>
        </FormField>
      </AdminSection>

      <AdminSection title={t('pricing.title')} description={t('pricing.description')}>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">{t('fields.mode')}</legend>
          <RadioGroup
            value={values.mode}
            onValueChange={(value) => handleModeChange(value as GarmentMode)}
            className="grid gap-2 sm:grid-cols-2"
          >
            {GARMENT_MODE_OPTIONS.map((mode) => (
              <RadioGroupOption
                key={mode}
                value={mode}
                card
                label={t(`mode.${mode}.label`)}
                description={t(`mode.${mode}.description`)}
              />
            ))}
          </RadioGroup>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField required>
            <FormLabel>{t('fields.price')}</FormLabel>
            <FormControl>
              <Input
                value={values.price}
                inputMode="decimal"
                onChange={(event) => set('price', event.target.value)}
                placeholder="185000"
                endAdornment={<span className="text-xs text-ink-subtle">{values.currency}</span>}
              />
            </FormControl>
            <FormHint>{t('hints.price')}</FormHint>
            <FormError>{errors.price}</FormError>
          </FormField>

          {values.mode === 'RENTAL' ? (
            <FormField required>
              <FormLabel>{t('fields.deposit')}</FormLabel>
              <FormControl>
                <Input
                  value={values.deposit}
                  inputMode="decimal"
                  onChange={(event) => set('deposit', event.target.value)}
                  placeholder="45000"
                  endAdornment={<span className="text-xs text-ink-subtle">{values.currency}</span>}
                />
              </FormControl>
              <FormHint>{t('hints.deposit')}</FormHint>
              <FormError>{errors.deposit}</FormError>
            </FormField>
          ) : (
            <div className="flex items-end">
              <p className="text-xs text-ink-muted">{t('hints.depositSaleOnly')}</p>
            </div>
          )}
        </div>

        {values.mode === 'SALE' ? (
          <Callout tone="info" title={t('depositNoticeTitle')}>
            {t('depositNoticeBody')}
          </Callout>
        ) : null}
      </AdminSection>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={saving} loadingLabel={submitLabel}>
          {submitLabel}
        </Button>
        {secondaryAction}
      </div>
    </form>
  );
}
