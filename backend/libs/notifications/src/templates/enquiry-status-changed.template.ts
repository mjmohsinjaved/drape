import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { ENQUIRY_STATUS_LABEL, type EnquiryStatusName, type LocalisedString } from './shared/copy';
import { pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface EnquiryStatusChangedProps {
  readonly enquiryReference: string;
  readonly previousStatus: EnquiryStatusName;
  readonly currentStatus: EnquiryStatusName;
  /** Note the studio chose to share. Never an internal admin note. */
  readonly studioNote: string | null;
  readonly enquiryUrl: string;
}

/**
 * Consumer-facing status change (C-33).
 *
 * D-14: the consumer sees words they recognise. `CLOSED_WON` and `CLOSED_LOST` are the studio's own
 * bookkeeping, so both read as "Closed" — the mapping lives in `shared/copy.ts`.
 */
const SUBJECT: Readonly<Record<NotificationLocale, (status: string, reference: string) => string>> =
  {
    EN: (status, reference) => `Your enquiry is now ${status.toLowerCase()} (${reference})`,
    UR: (status, reference) => `آپ کی انکوائری اب ${status} ہے (${reference})`,
  };

const HEADING: LocalisedString = {
  EN: 'Your enquiry moved on',
  UR: 'آپ کی انکوائری آگے بڑھی',
};

const PREHEADER: LocalisedString = {
  EN: 'The studio updated where things stand.',
  UR: 'اسٹوڈیو نے صورتِ حال اپ ڈیٹ کی ہے۔',
};

const LEAD: Readonly<Record<NotificationLocale, (from: string, to: string) => string>> = {
  EN: (from, to) =>
    `The studio moved your enquiry from ${from.toLowerCase()} to ${to.toLowerCase()}.`,
  UR: (from, to) => `اسٹوڈیو نے آپ کی انکوائری ${from} سے ${to} کر دی ہے۔`,
};

const NOTE_HEADING: LocalisedString = {
  EN: 'What the studio said',
  UR: 'اسٹوڈیو نے کیا کہا',
};

const CLOSED_NEXT: LocalisedString = {
  EN: 'Your shortlist stays saved. Send a new enquiry whenever you want to pick the thread back up.',
  UR: 'آپ کی شارٹ لسٹ محفوظ رہے گی۔ جب چاہیں نئی انکوائری بھیج کر بات دوبارہ شروع کر سکتے ہیں۔',
};

const OPEN_NEXT: LocalisedString = {
  EN: 'The studio replies to this address. Reply here and it reaches them.',
  UR: 'اسٹوڈیو اسی پتے پر جواب دیتا ہے۔ یہاں جواب دیں، وہ ان تک پہنچ جائے گا۔',
};

const BUTTON: LocalisedString = {
  EN: 'View enquiry',
  UR: 'انکوائری دیکھیں',
};

function isClosed(status: EnquiryStatusName): boolean {
  return status === 'CLOSED_WON' || status === 'CLOSED_LOST';
}

export const enquiryStatusChangedTemplate: TemplateDefinition<EnquiryStatusChangedProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const from = pick(locale, ENQUIRY_STATUS_LABEL[props.previousStatus]);
    const to = pick(locale, ENQUIRY_STATUS_LABEL[props.currentStatus]);

    const blocks: EmailBlock[] = [{ type: 'lead', text: pick(locale, LEAD)(from, to) }];

    if (props.studioNote !== null && props.studioNote.trim().length > 0) {
      blocks.push({ type: 'paragraph', text: pick(locale, NOTE_HEADING) });
      blocks.push({ type: 'quote', text: props.studioNote.trim(), attribution: context.brandName });
    }

    blocks.push({ type: 'button', label: pick(locale, BUTTON), url: props.enquiryUrl });
    blocks.push({
      type: 'paragraph',
      text: isClosed(props.currentStatus) ? pick(locale, CLOSED_NEXT) : pick(locale, OPEN_NEXT),
    });

    return {
      subject: pick(locale, SUBJECT)(to, props.enquiryReference),
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
