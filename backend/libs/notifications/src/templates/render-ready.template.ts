import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { SHORTLISTING_NOTE, type LocalisedString } from './shared/copy';
import { formatNumber, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface RenderReadyProps {
  readonly consumerName: string;
  readonly garmentTitle: string;
  /** Try-on result page the API built. */
  readonly resultUrl: string;
  /** Try-ons the consumer has left this period (C-5). Null when the caller has no figure to hand. */
  readonly tryOnsLeft: number | null;
}

/**
 * The try-on finished and is waiting (C-19).
 *
 * PRD §9.4: this is the template most at risk of preview language, so it is written tightly. It
 * says "your try-on", never "your look"; it never says "see yourself in"; it promises nothing about
 * accuracy; and it carries the shortlisting note in full.
 */
const SUBJECT: Readonly<Record<NotificationLocale, (garment: string) => string>> = {
  EN: (garment) => `Your try-on of ${garment} is ready`,
  UR: (garment) => `${garment} کی آپ کی ٹرائی آن تیار ہے`,
};

const HEADING: LocalisedString = {
  EN: 'Your try-on is ready',
  UR: 'آپ کی ٹرائی آن تیار ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Open it, then keep or drop it from your shortlist.',
  UR: 'اسے کھولیں، پھر اپنی شارٹ لسٹ میں رکھیں یا نکال دیں۔',
};

const LEAD: Readonly<Record<NotificationLocale, (name: string, garment: string) => string>> = {
  EN: (name, garment) => `${name}, your try-on of ${garment} is ready to open.`,
  UR: (name, garment) => `${name}، ${garment} کی آپ کی ٹرائی آن کھولنے کے لیے تیار ہے۔`,
};

const PURPOSE: LocalisedString = {
  EN: 'Use it to decide what stays on your shortlist and what does not.',
  UR: 'اس کی مدد سے طے کریں کہ آپ کی شارٹ لسٹ میں کیا رہے گا اور کیا نہیں۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open try-on',
  UR: 'ٹرائی آن کھولیں',
};

const REMAINING: Readonly<Record<NotificationLocale, (left: string) => string>> = {
  EN: (left) => `Try-ons left this month: ${left}.`,
  UR: (left) => `اس مہینے باقی ٹرائی آن: ${left}۔`,
};

export const renderReadyTemplate: TemplateDefinition<RenderReadyProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'lead', text: pick(locale, LEAD)(props.consumerName, props.garmentTitle) },
      { type: 'paragraph', text: pick(locale, PURPOSE) },
      { type: 'button', label: pick(locale, BUTTON), url: props.resultUrl },
      { type: 'note', text: pick(locale, SHORTLISTING_NOTE) },
    ];

    if (props.tryOnsLeft !== null) {
      blocks.push({
        type: 'paragraph',
        text: pick(locale, REMAINING)(formatNumber(props.tryOnsLeft, context)),
      });
    }

    return {
      subject: pick(locale, SUBJECT)(props.garmentTitle),
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
