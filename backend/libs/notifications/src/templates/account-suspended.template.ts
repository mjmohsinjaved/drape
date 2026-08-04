import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { formatDateTime, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface AccountSuspendedProps {
  readonly consumerName: string;
  readonly suspendedAt: Date;
  /** Reason the studio chose to share. Null when they gave none. */
  readonly reason: string | null;
}

/**
 * Account suspended by an admin (A-16, C-40).
 *
 * D-7: it says what happened and what to do next. It does not blame the reader, does not apologise,
 * and does not speculate about why — only the reason an admin actually wrote is shown.
 */
const SUBJECT: LocalisedString = {
  EN: 'Your Drape account is on hold',
  UR: 'آپ کا Drape اکاؤنٹ روک دیا گیا ہے',
};

const HEADING: LocalisedString = {
  EN: 'Your account is on hold',
  UR: 'آپ کا اکاؤنٹ روک دیا گیا ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Sign-in is paused. Your shortlist and photos stay as they are.',
  UR: 'سائن ان روک دیا گیا ہے۔ آپ کی شارٹ لسٹ اور تصاویر ویسے ہی رہیں گی۔',
};

const LEAD: LocalisedString = {
  EN: 'A Drape admin put your account on hold, so sign-in is paused for now.',
  UR: 'ایک Drape ایڈمن نے آپ کا اکاؤنٹ روک دیا ہے، اس لیے فی الحال سائن ان بند ہے۔',
};

const DATA_SAFE: LocalisedString = {
  EN: 'Nothing is deleted. Your shortlist, your try-on history and your photos stay exactly as they are.',
  UR: 'کچھ حذف نہیں ہوا۔ آپ کی شارٹ لسٹ، ٹرائی آن ہسٹری اور تصاویر بالکل ویسی ہی محفوظ ہیں۔',
};

const REASON_HEADING: LocalisedString = {
  EN: 'What the admin noted',
  UR: 'ایڈمن نے کیا لکھا',
};

const LABELS: Readonly<Record<NotificationLocale, string>> = {
  EN: 'On hold since',
  UR: 'کب سے روکا گیا',
};

const NEXT_STEP: Readonly<Record<NotificationLocale, (email: string) => string>> = {
  EN: (email) => `Email ${email} to ask about it. A person reads that address and will reply.`,
  UR: (email) =>
    `اس بارے میں پوچھنے کے لیے ${email} پر ای میل کریں۔ اس پتے کو ایک شخص پڑھتا ہے اور جواب دے گا۔`,
};

export const accountSuspendedTemplate: TemplateDefinition<AccountSuspendedProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'paragraph', text: `${props.consumerName},` },
      { type: 'lead', text: pick(locale, LEAD) },
      {
        type: 'facts',
        rows: [{ label: LABELS[locale], value: formatDateTime(props.suspendedAt, context) }],
      },
    ];

    if (props.reason !== null && props.reason.trim().length > 0) {
      blocks.push({ type: 'paragraph', text: pick(locale, REASON_HEADING) });
      blocks.push({ type: 'quote', text: props.reason.trim(), attribution: context.brandName });
    }

    blocks.push({ type: 'paragraph', text: pick(locale, DATA_SAFE) });
    blocks.push({ type: 'paragraph', text: pick(locale, NEXT_STEP)(context.supportEmail) });

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
