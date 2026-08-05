'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button, Callout, EmptyState, toast } from '@repo/ui';

import { AdminPage, AdminPageHeader } from '@/features/catalog/components/AdminPage';
import { GarmentForm } from '@/features/catalog/components/GarmentForm';
import { useCatalogErrorCopy } from '@/features/catalog/hooks/use-catalog-error';
import { useCreateGarment } from '@/features/catalog/hooks/use-garments';
import {
  emptyGarmentForm,
  formToCreateBody,
  type GarmentFormValues,
} from '@/features/catalog/schemas/garment-form';
import { routes } from '@/lib/routes';

import type { AdminCategory } from '@/features/categories/types/admin-categories';
import type { Locale } from '@/i18n/config';

export interface NewGarmentScreenProps {
  locale: Locale;
  categories: AdminCategory[];
}

/**
 * A-8 — creating a piece.
 *
 * Images cannot be attached yet: a `GARMENT_IMAGE` upload ticket is scoped to a garment id
 * (§3.5), so the record has to exist before a photograph can hang from it. Rather than pretend
 * otherwise with a dropzone that would fail, the screen says where photographs come next and
 * takes the admin straight there on save.
 *
 * With no categories there is nothing to create against — `categoryId` is required — so the
 * screen shows the way to make one instead of a form that cannot be submitted (D-6).
 */
export function NewGarmentScreen({ locale, categories }: NewGarmentScreenProps) {
  const t = useTranslations('admin.catalog.new');
  const errorCopy = useCatalogErrorCopy();
  const router = useRouter();

  const createGarment = useCreateGarment();
  const selectable = categories.filter((category) => !category.archived);
  const [values, setValues] = useState<GarmentFormValues>(() =>
    emptyGarmentForm(selectable[0]?.id ?? ''),
  );

  const handleSubmit = async (): Promise<void> => {
    try {
      const created = await createGarment.mutateAsync(formToCreateBody(values));
      toast.success(t('toast.created', { title: created.title }), {
        description: t('toast.createdHint'),
      });
      router.push(routes.admin.garment(locale, created.id));
    } catch (error: unknown) {
      toast.error(errorCopy.message(error));
    }
  };

  if (selectable.length === 0) {
    return (
      <AdminPage>
        <AdminPageHeader title={t('title')} description={t('description')} />
        <EmptyState
          title={t('noCategories.title')}
          description={t('noCategories.body')}
          action={
            <Button asChild>
              <Link href={routes.admin.categories(locale)}>{t('noCategories.action')}</Link>
            </Button>
          }
        />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <AdminPageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={routes.admin.catalog(locale)}>{t('cancel')}</Link>
          </Button>
        }
      />

      <Callout tone="info" title={t('photosNextTitle')}>
        {t('photosNextBody')}
      </Callout>

      <GarmentForm
        values={values}
        onChange={setValues}
        categories={selectable}
        onSubmit={handleSubmit}
        submitLabel={t('save')}
        saving={createGarment.isPending}
      />
    </AdminPage>
  );
}
