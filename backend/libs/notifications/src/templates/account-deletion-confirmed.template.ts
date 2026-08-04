import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { formatDateTime, formatNumber, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface AccountDeletionConfirmedProps {
  readonly consumerName: string;
  readonly deletedAt: Date;
  readonly photosDeleted: number;
  readonly tryOnsDeleted: number;
  readonly shareLinksRevoked: number;
}

/**
 * Confirms a consumer-initiated deletion finished (C-38, A-20, §9.3).
 *
 * D-13: the control said "Delete account", so the confirmation says deleted. It lists what went, so
 * the reader does not have to trust a bare claim.
 */
const SUBJECT: LocalisedString = {
  EN: 'Your Drape account is deleted',
  UR: 'آپ کا Drape اکاؤنٹ حذف ہو گیا',
};

const HEADING: LocalisedString = {
  EN: 'Your account is deleted',
  UR: 'آپ کا اکاؤنٹ حذف ہو گیا',
};

const PREHEADER: LocalisedString = {
  EN: 'Here is exactly what was removed.',
  UR: 'یہ رہی تفصیل کہ کیا کچھ ہٹایا گیا۔',
};

const LEAD: Readonly<Record<NotificationLocale, (name: string) => string>> = {
  EN: (name) => `${name}, we deleted your Drape account and everything stored with it.`,
  UR: (name) => `${name}، ہم نے آپ کا Drape اکاؤنٹ اور اس کے ساتھ محفوظ ہر چیز حذف کر دی ہے۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    when: 'Deleted',
    photos: 'Photos removed',
    tryOns: 'Try-ons removed',
    shareLinks: 'Share links turned off',
  },
  UR: {
    when: 'حذف ہوا',
    photos: 'ہٹائی گئی تصاویر',
    tryOns: 'ہٹائی گئی ٹرائی آن',
    shareLinks: 'بند کیے گئے شیئر لنکس',
  },
};

const RESIDUAL: Readonly<Record<NotificationLocale, (brand: string) => string>> = {
  EN: (brand) =>
    `Enquiries you already sent stay with the ${brand} team in their own email, the way any message you send does.`,
  UR: (brand) =>
    `جو انکوائریاں آپ پہلے بھیج چکے ہیں وہ ${brand} کی ٹیم کی اپنی ای میل میں رہیں گی، بالکل ویسے ہی جیسے آپ کا بھیجا کوئی بھی پیغام۔`,
};

const CLOSING: LocalisedString = {
  EN: 'Nothing else is kept. You are welcome to start again with a new account whenever you like.',
  UR: 'اس کے علاوہ کچھ محفوظ نہیں رکھا گیا۔ آپ جب چاہیں نیا اکاؤنٹ بنا کر دوبارہ شروع کر سکتے ہیں۔',
};

export const accountDeletionConfirmedTemplate: TemplateDefinition<AccountDeletionConfirmedProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const labels = LABELS[locale];

    const blocks: EmailBlock[] = [
      { type: 'lead', text: pick(locale, LEAD)(props.consumerName) },
      {
        type: 'facts',
        rows: [
          { label: labels.when, value: formatDateTime(props.deletedAt, context) },
          { label: labels.photos, value: formatNumber(props.photosDeleted, context) },
          { label: labels.tryOns, value: formatNumber(props.tryOnsDeleted, context) },
          { label: labels.shareLinks, value: formatNumber(props.shareLinksRevoked, context) },
        ],
      },
      { type: 'paragraph', text: pick(locale, RESIDUAL)(context.brandName) },
      { type: 'paragraph', text: pick(locale, CLOSING) },
    ];

    return {
      subject: pick(locale, SUBJECT),
      ...renderLayout({
        locale,
        brandName: context.brandName,
        preheader: pick(locale, PREHEADER),
        heading: pick(locale, HEADING),
        blocks,
      }),
    };
  },
};
