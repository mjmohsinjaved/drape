import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface AccountApprovedProps {
  readonly consumerName: string;
  readonly signInUrl: string;
}

const SUBJECT: LocalisedString = {
  EN: 'Your Drape account is ready',
  UR: 'آپ کا Drape اکاؤنٹ تیار ہے',
};

const HEADING: LocalisedString = {
  EN: 'You can sign in now',
  UR: 'اب آپ سائن اِن کر سکتی ہیں',
};

const PREHEADER: LocalisedString = {
  EN: 'Your account has been approved.',
  UR: 'آپ کا اکاؤنٹ منظور ہو گیا ہے۔',
};

const LEAD: LocalisedString = {
  EN: 'Your account has been approved, so sign-in is open.',
  UR: 'آپ کا اکاؤنٹ منظور ہو گیا ہے، اس لیے سائن اِن کھل گیا ہے۔',
};

const WHATS_NEXT: LocalisedString = {
  EN: 'Add a full-length photo of yourself, then try any piece in the collection on it.',
  UR: 'اپنی پوری قد کی ایک تصویر شامل کیجیے، پھر مجموعے کا کوئی بھی ملبوس اُس پر آزمائیے۔',
};

const CTA: LocalisedString = {
  EN: 'Sign in',
  UR: 'سائن اِن',
};

export const accountApprovedTemplate: TemplateDefinition<AccountApprovedProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'paragraph', text: `${props.consumerName},` },
      { type: 'lead', text: pick(locale, LEAD) },
      { type: 'button', label: pick(locale, CTA), url: props.signInUrl },
      { type: 'paragraph', text: pick(locale, WHATS_NEXT) },
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
