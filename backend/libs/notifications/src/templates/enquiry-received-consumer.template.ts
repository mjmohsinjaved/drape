import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { SHORTLISTING_NOTE, type LocalisedString } from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface EnquiryReceivedConsumerProps {
  readonly consumerName: string;
  readonly enquiryReference: string;
  /** Titles of the pieces the consumer sent through. */
  readonly garmentTitles: readonly string[];
  /** Consumer-facing enquiry page the API built. */
  readonly enquiryUrl: string;
}

/**
 * Confirms an enquiry reached the studio (C-32).
 *
 * The shortlisting note is mandatory here: the consumer is about to talk to a studio about pieces
 * they only saw as try-ons, so the message says plainly what a try-on is and is not.
 */
const SUBJECT: Readonly<Record<NotificationLocale, (reference: string) => string>> = {
  EN: (reference) => `Your enquiry is with the studio (${reference})`,
  UR: (reference) => `آپ کی انکوائری اسٹوڈیو تک پہنچ گئی (${reference})`,
};

const HEADING: LocalisedString = {
  EN: 'Your enquiry is with the studio',
  UR: 'آپ کی انکوائری اسٹوڈیو تک پہنچ گئی',
};

const PREHEADER: LocalisedString = {
  EN: 'The studio replies by email.',
  UR: 'اسٹوڈیو ای میل پر جواب دے گا۔',
};

const LEAD: Readonly<Record<NotificationLocale, (name: string, brand: string) => string>> = {
  EN: (name, brand) =>
    `Thanks ${name} — the ${brand} team has your enquiry and replies to this address.`,
  UR: (name, brand) =>
    `شکریہ ${name} — ${brand} کی ٹیم کو آپ کی انکوائری مل گئی ہے اور وہ اسی پتے پر جواب دے گی۔`,
};

const ITEMS_HEADING: LocalisedString = {
  EN: 'The pieces you sent',
  UR: 'آپ نے جو ملبوسات بھیجے',
};

const REFERENCE_LINE: Readonly<Record<NotificationLocale, (reference: string) => string>> = {
  EN: (reference) => `Quote ${reference} if you write to the studio directly.`,
  UR: (reference) => `اگر آپ براہِ راست اسٹوڈیو کو لکھیں تو ${reference} کا حوالہ دیں۔`,
};

const KEEP_SHORTLISTING: LocalisedString = {
  EN: 'Your shortlist stays saved. You can add pieces to it while you wait.',
  UR: 'آپ کی شارٹ لسٹ محفوظ رہے گی۔ انتظار کے دوران آپ اس میں مزید ملبوسات شامل کر سکتے ہیں۔',
};

const BUTTON: LocalisedString = {
  EN: 'View enquiry',
  UR: 'انکوائری دیکھیں',
};

export const enquiryReceivedConsumerTemplate: TemplateDefinition<EnquiryReceivedConsumerProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'lead', text: pick(locale, LEAD)(props.consumerName, context.brandName) },
      { type: 'paragraph', text: pick(locale, ITEMS_HEADING) },
      { type: 'list', items: props.garmentTitles },
      { type: 'note', text: pick(locale, SHORTLISTING_NOTE) },
      { type: 'button', label: pick(locale, BUTTON), url: props.enquiryUrl },
      { type: 'paragraph', text: pick(locale, REFERENCE_LINE)(props.enquiryReference) },
      { type: 'paragraph', text: pick(locale, KEEP_SHORTLISTING) },
    ];

    return {
      subject: pick(locale, SUBJECT)(props.enquiryReference),
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
