import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface BudgetExhaustedConsumerProps {
  readonly consumerName: string;
  /** The consumer's shortlist page. */
  readonly shortlistUrl: string;
  /** Where the consumer sends an enquiry from. */
  readonly enquiryUrl: string;
}

/**
 * Sent when the studio-wide budget runs out and a consumer's generation is turned away
 * (PRD §8.3, row "System budget exhausted").
 *
 * **The lead sentence is the exact string PRD §8.3 specifies.** It is not paraphrased, shortened or
 * softened here, and `CAPACITY_MESSAGE_EN` is asserted verbatim by the spec so it cannot drift.
 */
export const CAPACITY_MESSAGE_EN =
  "Our fitting room is at capacity today — we'll email you when it's back.";

const CAPACITY_MESSAGE: LocalisedString = {
  EN: CAPACITY_MESSAGE_EN,
  UR: 'آج ہمارا فٹنگ روم اپنی گنجائش پر ہے — جیسے ہی یہ واپس آئے گا ہم آپ کو ای میل کریں گے۔',
};

const SUBJECT: LocalisedString = {
  EN: 'Our fitting room is at capacity today',
  UR: 'آج ہمارا فٹنگ روم اپنی گنجائش پر ہے',
};

const HEADING: LocalisedString = {
  EN: 'Our fitting room is at capacity today',
  UR: 'آج ہمارا فٹنگ روم اپنی گنجائش پر ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Your shortlist is saved. We email you when try-ons are back.',
  UR: 'آپ کی شارٹ لسٹ محفوظ ہے۔ ٹرائی آن واپس آتے ہی ہم آپ کو ای میل کریں گے۔',
};

const GREETING: Readonly<Record<'EN' | 'UR', (name: string) => string>> = {
  EN: (name) => `Hello ${name},`,
  UR: (name) => `${name}، السلام علیکم`,
};

const SHORTLIST_SAFE: LocalisedString = {
  EN: 'Your shortlist is saved, and everything you have already tried on stays in your history.',
  UR: 'آپ کی شارٹ لسٹ محفوظ ہے، اور جو کچھ آپ پہلے ٹرائی کر چکے ہیں وہ آپ کی ہسٹری میں موجود رہے گا۔',
};

const NEXT_ACTION: LocalisedString = {
  EN: 'You can send an enquiry about your shortlist any time — it does not need a new try-on.',
  UR: 'آپ اپنی شارٹ لسٹ کے بارے میں کسی بھی وقت انکوائری بھیج سکتے ہیں — اس کے لیے نئی ٹرائی آن کی ضرورت نہیں۔',
};

const SHORTLIST_BUTTON: LocalisedString = {
  EN: 'Open your shortlist',
  UR: 'اپنی شارٹ لسٹ کھولیں',
};

const ENQUIRY_LINK: LocalisedString = {
  EN: 'Send an enquiry',
  UR: 'انکوائری بھیجیں',
};

export const budgetExhaustedConsumerTemplate: TemplateDefinition<BudgetExhaustedConsumerProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'paragraph', text: GREETING[locale](props.consumerName) },
      // PRD §8.3 verbatim. Do not reword.
      { type: 'lead', text: pick(locale, CAPACITY_MESSAGE) },
      { type: 'paragraph', text: pick(locale, SHORTLIST_SAFE) },
      { type: 'paragraph', text: pick(locale, NEXT_ACTION) },
      { type: 'button', label: pick(locale, SHORTLIST_BUTTON), url: props.shortlistUrl },
      { type: 'link', label: pick(locale, ENQUIRY_LINK), url: props.enquiryUrl },
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
