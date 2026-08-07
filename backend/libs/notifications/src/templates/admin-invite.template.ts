import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { BUTTON_FALLBACK, type LocalisedString } from './shared/copy';
import { formatDateTime, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface AdminInviteProps {
  /** Name of the admin who sent the invite. */
  readonly inviterName: string;
  /** Link the API built, carrying the single-use invite token. */
  readonly acceptUrl: string;
  /** `INVITE_TTL_DAYS` applied to the invite row. */
  readonly expiresAt: Date;
}

/** D-13: the control says "Accept invite" here and in the web app, and stays that name in the flow. */
const SUBJECT: Readonly<Record<NotificationLocale, (inviter: string) => string>> = {
  EN: (inviter) => `${inviter} invited you to the Drape admin console`,
  UR: (inviter) => `${inviter} نے آپ کو Drape ایڈمن کنسول میں مدعو کیا ہے`,
};

const HEADING: LocalisedString = {
  EN: 'You have an invite to the admin console',
  UR: 'آپ کو ایڈمن کنسول کی دعوت ملی ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Accept it to set your password and sign in.',
  UR: 'پاس ورڈ سیٹ کرنے اور سائن ان کرنے کے لیے دعوت قبول کریں۔',
};

const LEAD: Readonly<Record<NotificationLocale, (inviter: string) => string>> = {
  EN: (inviter) =>
    `${inviter} invited you to help run the Drape catalogue — garments, categories, enquiries and consumer accounts.`,
  UR: (inviter) =>
    `${inviter} نے آپ کو Drape کیٹلاگ چلانے میں مدد کے لیے مدعو کیا ہے — ملبوسات، زمرے، انکوائریاں اور صارف اکاؤنٹس۔`,
};

const BUTTON: LocalisedString = {
  EN: 'Accept invite',
  UR: 'دعوت قبول کریں',
};

const EXPIRY: Readonly<Record<NotificationLocale, (when: string) => string>> = {
  EN: (when) => `The invite expires on ${when}. After that an admin has to send a new one.`,
  UR: (when) => `یہ دعوت ${when} کو ختم ہو جائے گی۔ اس کے بعد کسی ایڈمن کو نئی دعوت بھیجنی ہوگی۔`,
};

const NEXT_STEP: LocalisedString = {
  EN: 'Accepting the invite asks you to set a password.',
  UR: 'دعوت قبول کرنے پر آپ سے پاس ورڈ سیٹ کرنے کو کہا جائے گا۔',
};

export const adminInviteTemplate: TemplateDefinition<AdminInviteProps> = {
  channel: 'EMAIL',
  audience: 'ADMIN',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'lead', text: pick(locale, LEAD)(props.inviterName) },
      { type: 'button', label: pick(locale, BUTTON), url: props.acceptUrl },
      { type: 'paragraph', text: pick(locale, NEXT_STEP) },
      { type: 'paragraph', text: pick(locale, EXPIRY)(formatDateTime(props.expiresAt, context)) },
      { type: 'paragraph', text: pick(locale, BUTTON_FALLBACK) },
      { type: 'link', label: props.acceptUrl, url: props.acceptUrl },
    ];

    return {
      subject: pick(locale, SUBJECT)(props.inviterName),
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
