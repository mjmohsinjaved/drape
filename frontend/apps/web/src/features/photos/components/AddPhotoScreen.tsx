import { getTranslations } from 'next-intl/server';

import { Separator } from '@repo/ui';

import { DeleteMyDataLink } from '@/features/consent/components/DeleteMyDataLink';
import { listPhotosServer } from '@/features/photos/api/server';
import { PhotoGuidance } from '@/features/photos/components/PhotoGuidance';
import { PhotoUploader } from '@/features/photos/components/PhotoUploader';

import type { Locale } from '@/i18n/config';

export interface AddPhotoScreenProps {
  locale: Locale;
  returnTo?: string;
}

/**
 * Add a photo — C-13, C-14, C-15.
 *
 * **The guidance comes first and the picker second**, which is the requirement rather than a
 * layout preference: C-13 says "guidance *before* the picker", and §10.3 asks for it to be clear
 * enough that a first attempt usually passes. Putting the button above the six drawings would
 * technically satisfy neither.
 *
 * The list read below only answers one question — is this her first photo? — which decides
 * whether the new one silently becomes active. A failure to answer it is not worth blocking the
 * screen for, so it degrades to "not her first", which is the safer default: an upload then
 * never changes which photo her next try-on uses without her saying so.
 */
export async function AddPhotoScreen({ locale, returnTo }: AddPhotoScreenProps) {
  const t = await getTranslations({ locale, namespace: 'photos' });
  const existing = await listPhotosServer();
  const isFirstPhoto = existing.ok && existing.data.length === 0;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-balance md:text-4xl">{t('meta.newTitle')}</h1>
        <p className="max-w-prose text-ink-muted">{t('meta.newDescription')}</p>
      </header>

      <PhotoGuidance />

      <Separator />

      <PhotoUploader locale={locale} isFirstPhoto={isFirstPhoto} returnTo={returnTo} />

      <DeleteMyDataLink locale={locale} />
    </div>
  );
}
