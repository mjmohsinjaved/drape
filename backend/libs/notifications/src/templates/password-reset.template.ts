import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { BUTTON_FALLBACK, NEUTRAL_FOOTER, type LocalisedString } from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface PasswordResetProps {
  /** Link the API built, carrying the single-use token. */
  readonly resetUrl: string;
  /** `PASSWORD_RESET_TTL_MINUTES`. */
  readonly expiresInMinutes: number;
}

/**
 * S-6: this email must not reveal whether an account exists.
 *
 * It is written from the request's point of view — "someone asked to reset the password for this
 * email address" — so the wording is identical whether or not there is an account behind it, and
 * the API's response is identical either way too.
 */
const SUBJECT: LocalisedString = {
  EN: 'Reset your password',
  UR: 'اپنا پاس ورڈ دوبارہ سیٹ کریں',
};

const HEADING: LocalisedString = {
  EN: 'Reset your password',
  UR: 'اپنا پاس ورڈ دوبارہ سیٹ کریں',
};

const PREHEADER: LocalisedString = {
  EN: 'Choose a new password from this link.',
  UR: 'اس لنک سے نیا پاس ورڈ چنیں۔',
};

const LEAD: LocalisedString = {
  EN: 'Someone asked to reset the password for this email address. If that was you, choose a new one.',
  UR: 'کسی نے اس ای میل پتے کا پاس ورڈ دوبارہ سیٹ کرنے کی درخواست دی ہے۔ اگر یہ آپ تھے تو نیا پاس ورڈ چنیں۔',
};

const BUTTON: LocalisedString = {
  EN: 'Choose a new password',
  UR: 'نیا پاس ورڈ چنیں',
};

const EXPIRY: Readonly<Record<NotificationLocale, (minutes: number) => string>> = {
  EN: (minutes) => `The link works for ${minutes} minutes and once only.`,
  UR: (minutes) => `یہ لنک ${minutes} منٹ اور صرف ایک بار کام کرتا ہے۔`,
};

const NO_ACTION: LocalisedString = {
  EN: 'If you did not ask for this, ignore this email. The password stays as it is until the link is used.',
  UR: 'اگر آپ نے یہ درخواست نہیں دی تو اس ای میل کو نظر انداز کر دیں۔ لنک استعمال ہونے تک پاس ورڈ ویسا ہی رہے گا۔',
};

export const passwordResetTemplate: TemplateDefinition<PasswordResetProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'lead', text: pick(locale, LEAD) },
      { type: 'button', label: pick(locale, BUTTON), url: props.resetUrl },
      { type: 'paragraph', text: pick(locale, EXPIRY)(props.expiresInMinutes) },
      { type: 'paragraph', text: pick(locale, BUTTON_FALLBACK) },
      { type: 'link', label: props.resetUrl, url: props.resetUrl },
      { type: 'paragraph', text: pick(locale, NO_ACTION) },
    ];

    return {
      subject: pick(locale, SUBJECT),
      ...renderLayout({
        locale,
        brandName: context.brandName,
        preheader: pick(locale, PREHEADER),
        heading: pick(locale, HEADING),
        blocks,
        footerLines: NEUTRAL_FOOTER[locale],
      }),
    };
  },
};
