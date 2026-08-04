import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface OtpSmsProps {
  /** The one-time code. Never logged, never echoed into an email subject. */
  readonly code: string;
  /** `OTP_TTL_SECONDS` expressed in whole minutes. */
  readonly expiresInMinutes: number;
}

/**
 * Phone OTP (C-3). **Text only** — the SMS path reads `text` and ignores `html`.
 *
 * The `html` field is still produced so the registry has one uniform contract; it is what the code
 * would look like if the same message were ever mailed. The body is kept inside a single SMS
 * segment and carries the standard anti-phishing line.
 */
const SMS_BODY: Readonly<Record<NotificationLocale, (code: string, minutes: number) => string>> = {
  EN: (code, minutes) =>
    `${code} is your Drape code. It works for ${minutes} minutes. Drape never asks you for this code.`,
  UR: (code, minutes) =>
    `${code} آپ کا Drape کوڈ ہے۔ یہ ${minutes} منٹ کام کرتا ہے۔ Drape آپ سے کبھی یہ کوڈ نہیں مانگتا۔`,
};

const SUBJECT: LocalisedString = {
  EN: 'Your Drape code',
  UR: 'آپ کا Drape کوڈ',
};

const HEADING: LocalisedString = {
  EN: 'Your Drape code',
  UR: 'آپ کا Drape کوڈ',
};

const PREHEADER: LocalisedString = {
  EN: 'Enter the code to confirm your number.',
  UR: 'اپنا نمبر تصدیق کرنے کے لیے کوڈ درج کریں۔',
};

const CAPTION: LocalisedString = {
  EN: 'Enter this code to confirm your number.',
  UR: 'اپنا نمبر تصدیق کرنے کے لیے یہ کوڈ درج کریں۔',
};

const WARNING: LocalisedString = {
  EN: 'Drape never asks you for this code. If you did not ask for it, ignore this message.',
  UR: 'Drape آپ سے کبھی یہ کوڈ نہیں مانگتا۔ اگر آپ نے یہ نہیں مانگا تو اس پیغام کو نظر انداز کر دیں۔',
};

export const otpSmsTemplate: TemplateDefinition<OtpSmsProps> = {
  channel: 'SMS',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'code', value: props.code, caption: pick(locale, CAPTION) },
      { type: 'paragraph', text: pick(locale, WARNING) },
    ];

    const body = renderLayout({
      locale,
      brandName: context.brandName,
      preheader: pick(locale, PREHEADER),
      heading: pick(locale, HEADING),
      blocks,
    });

    return {
      subject: pick(locale, SUBJECT),
      html: body.html,
      // The SMS body, not the layout's text alternative — a gateway gets one plain sentence.
      text: pick(locale, SMS_BODY)(props.code, props.expiresInMinutes),
    };
  },
};
