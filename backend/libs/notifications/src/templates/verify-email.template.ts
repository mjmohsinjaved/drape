import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import {
  BUTTON_FALLBACK,
  IGNORE_IF_UNEXPECTED,
  NEUTRAL_FOOTER,
  type LocalisedString,
} from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface VerifyEmailProps {
  /** Link the API built. The library never guesses a web route. */
  readonly verifyUrl: string;
  /** `EMAIL_VERIFY_TTL_HOURS`. */
  readonly expiresInHours: number;
}

/**
 * Sent to an address that has just been entered on signup.
 *
 * S-6: the copy never confirms that an account exists. It talks about "this address", not "your
 * account", and the same email is safe to send whatever the account state.
 */
const SUBJECT: LocalisedString = {
  EN: 'Confirm your email address',
  UR: 'اپنے ای میل پتے کی تصدیق کریں',
};

const HEADING: LocalisedString = {
  EN: 'Confirm your email address',
  UR: 'اپنے ای میل پتے کی تصدیق کریں',
};

const PREHEADER: LocalisedString = {
  EN: 'One tap finishes the setup.',
  UR: 'ایک ٹیپ سے سیٹ اپ مکمل ہو جائے گا۔',
};

const LEAD: LocalisedString = {
  EN: 'Confirm this address to finish setting up Drape and start shortlisting.',
  UR: 'Drape کا سیٹ اپ مکمل کرنے اور شارٹ لسٹ بنانا شروع کرنے کے لیے اس پتے کی تصدیق کریں۔',
};

const BUTTON: LocalisedString = {
  EN: 'Confirm email',
  UR: 'ای میل کی تصدیق کریں',
};

const EXPIRY: Readonly<Record<NotificationLocale, (hours: number) => string>> = {
  EN: (hours) => `The link works for ${hours} hours and once only.`,
  UR: (hours) => `یہ لنک ${hours} گھنٹے اور صرف ایک بار کام کرتا ہے۔`,
};

export const verifyEmailTemplate: TemplateDefinition<VerifyEmailProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'lead', text: pick(locale, LEAD) },
      { type: 'button', label: pick(locale, BUTTON), url: props.verifyUrl },
      { type: 'paragraph', text: pick(locale, EXPIRY)(props.expiresInHours) },
      { type: 'paragraph', text: pick(locale, BUTTON_FALLBACK) },
      { type: 'link', label: props.verifyUrl, url: props.verifyUrl },
      { type: 'paragraph', text: pick(locale, IGNORE_IF_UNEXPECTED) },
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
