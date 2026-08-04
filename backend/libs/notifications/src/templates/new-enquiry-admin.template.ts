import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { formatDateTime, formatNumber, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface NewEnquiryAdminProps {
  /** Short human reference the admin console shows, e.g. `ENQ-1042`. */
  readonly enquiryReference: string;
  readonly consumerName: string;
  /** Event the consumer is shopping for, already translated by the caller. */
  readonly eventType: string;
  /** Event date when the consumer gave one. */
  readonly eventDate: Date | null;
  /** Budget band label, already translated by the caller. */
  readonly budgetBand: string | null;
  readonly itemCount: number;
  /** Titles of the shortlisted garments, in shortlist order. */
  readonly garmentTitles: readonly string[];
  readonly submittedAt: Date;
  /** Admin console deep link the API built. */
  readonly enquiryUrl: string;
}

/** Operator-facing (A-25). Plain, scannable, and it names the next action. */
const SUBJECT: Readonly<Record<NotificationLocale, (name: string, reference: string) => string>> = {
  EN: (name, reference) => `New enquiry from ${name} (${reference})`,
  UR: (name, reference) => `${name} کی طرف سے نئی انکوائری (${reference})`,
};

const HEADING: LocalisedString = {
  EN: 'A consumer sent an enquiry',
  UR: 'ایک صارف نے انکوائری بھیجی ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Open it to reply.',
  UR: 'جواب دینے کے لیے اسے کھولیں۔',
};

const LEAD: Readonly<Record<NotificationLocale, (name: string, count: string) => string>> = {
  EN: (name, count) => `${name} shortlisted ${count} pieces and asked to hear from the studio.`,
  UR: (name, count) =>
    `${name} نے ${count} ملبوسات شارٹ لسٹ کیے اور اسٹوڈیو سے رابطے کی درخواست دی ہے۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    reference: 'Reference',
    consumer: 'Consumer',
    event: 'Event',
    eventDate: 'Event date',
    budget: 'Budget',
    items: 'Pieces',
    submitted: 'Sent',
    notGiven: 'Not given',
  },
  UR: {
    reference: 'حوالہ',
    consumer: 'صارف',
    event: 'تقریب',
    eventDate: 'تقریب کی تاریخ',
    budget: 'بجٹ',
    items: 'ملبوسات',
    submitted: 'بھیجی گئی',
    notGiven: 'نہیں دیا گیا',
  },
};

const SHORTLIST_HEADING: LocalisedString = {
  EN: 'Shortlisted pieces',
  UR: 'شارٹ لسٹ کیے گئے ملبوسات',
};

const BUTTON: LocalisedString = {
  EN: 'Open enquiry',
  UR: 'انکوائری کھولیں',
};

export const newEnquiryAdminTemplate: TemplateDefinition<NewEnquiryAdminProps> = {
  channel: 'EMAIL',
  audience: 'ADMIN',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const labels = LABELS[locale];

    const blocks: EmailBlock[] = [
      {
        type: 'lead',
        text: pick(locale, LEAD)(props.consumerName, formatNumber(props.itemCount, context)),
      },
      {
        type: 'facts',
        rows: [
          { label: labels.reference, value: props.enquiryReference },
          { label: labels.consumer, value: props.consumerName },
          { label: labels.event, value: props.eventType },
          {
            label: labels.eventDate,
            value:
              props.eventDate === null ? labels.notGiven : formatDateTime(props.eventDate, context),
          },
          { label: labels.budget, value: props.budgetBand ?? labels.notGiven },
          { label: labels.items, value: formatNumber(props.itemCount, context) },
          { label: labels.submitted, value: formatDateTime(props.submittedAt, context) },
        ],
      },
      { type: 'paragraph', text: pick(locale, SHORTLIST_HEADING) },
      { type: 'list', items: props.garmentTitles },
      { type: 'button', label: pick(locale, BUTTON), url: props.enquiryUrl },
    ];

    return {
      subject: pick(locale, SUBJECT)(props.consumerName, props.enquiryReference),
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
