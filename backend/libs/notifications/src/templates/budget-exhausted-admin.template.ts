import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { OPERATOR_FOOTER, type LocalisedString } from './shared/copy';
import { formatDateTime, formatNumber, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface BudgetExhaustedAdminProps {
  /** Ledger period, e.g. `2026-08`. */
  readonly period: string;
  readonly budgetGenerations: number;
  /** When the budget hit its ceiling. */
  readonly exhaustedAt: Date;
  /** When the next period starts. */
  readonly resetsAt: Date;
  /** Consumers who hit the wall since the budget ran out. */
  readonly affectedConsumers: number;
  /** Admin settings page the API built. */
  readonly settingsUrl: string;
}

/** Operator alert, PRD §8.3 "Alert Admin immediately" and E-14. */
const SUBJECT: LocalisedString = {
  EN: 'Try-on budget is used up — consumers are blocked',
  UR: 'ٹرائی آن بجٹ ختم ہو گیا — صارفین رکے ہوئے ہیں',
};

const HEADING: LocalisedString = {
  EN: 'The monthly try-on budget is used up',
  UR: 'ماہانہ ٹرائی آن بجٹ ختم ہو گیا',
};

const PREHEADER: LocalisedString = {
  EN: 'Raise the budget to start generations again.',
  UR: 'جنریشن دوبارہ شروع کرنے کے لیے بجٹ بڑھائیں۔',
};

const LEAD: Readonly<Record<NotificationLocale, (budget: string, period: string) => string>> = {
  EN: (budget, period) =>
    `The studio used all ${budget} generations for ${period}. Consumers cannot generate try-ons right now.`,
  UR: (budget, period) =>
    `${period} کے لیے تمام ${budget} جنریشن استعمال ہو چکی ہیں۔ صارفین اس وقت ٹرائی آن نہیں بنا سکتے۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    period: 'Period',
    budget: 'Budget',
    exhausted: 'Ran out',
    resets: 'Resets',
    affected: 'Consumers held up',
  },
  UR: {
    period: 'مدت',
    budget: 'بجٹ',
    exhausted: 'ختم ہوا',
    resets: 'ری سیٹ',
    affected: 'رکے ہوئے صارفین',
  },
};

const CONSUMER_VIEW: LocalisedString = {
  EN: 'Consumers see: "Our fitting room is at capacity today — we\'ll email you when it\'s back." Their interest is captured, and they are emailed once generations resume.',
  UR: 'صارفین کو یہ نظر آ رہا ہے: "آج ہمارا فٹنگ روم اپنی گنجائش پر ہے — جیسے ہی یہ واپس آئے گا ہم آپ کو ای میل کریں گے۔" ان کی دلچسپی محفوظ ہو رہی ہے اور جنریشن بحال ہوتے ہی انہیں ای میل بھیج دی جائے گی۔',
};

const ACTION: LocalisedString = {
  EN: 'Raise the monthly budget in Settings to start generations again, or wait for the reset.',
  UR: 'جنریشن دوبارہ شروع کرنے کے لیے سیٹنگز میں ماہانہ بجٹ بڑھائیں، یا ری سیٹ کا انتظار کریں۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open settings',
  UR: 'سیٹنگز کھولیں',
};

export const budgetExhaustedAdminTemplate: TemplateDefinition<BudgetExhaustedAdminProps> = {
  channel: 'EMAIL',
  audience: 'ADMIN',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const labels = LABELS[locale];

    const blocks: EmailBlock[] = [
      {
        type: 'lead',
        text: pick(locale, LEAD)(formatNumber(props.budgetGenerations, context), props.period),
      },
      {
        type: 'facts',
        rows: [
          { label: labels.period, value: props.period },
          { label: labels.budget, value: formatNumber(props.budgetGenerations, context) },
          { label: labels.exhausted, value: formatDateTime(props.exhaustedAt, context) },
          { label: labels.resets, value: formatDateTime(props.resetsAt, context) },
          { label: labels.affected, value: formatNumber(props.affectedConsumers, context) },
        ],
      },
      { type: 'paragraph', text: pick(locale, CONSUMER_VIEW) },
      { type: 'paragraph', text: pick(locale, ACTION) },
      { type: 'button', label: pick(locale, BUTTON), url: props.settingsUrl },
    ];

    return {
      subject: pick(locale, SUBJECT),
      ...renderLayout({
        locale,
        brandName: context.brandName,
        preheader: pick(locale, PREHEADER),
        heading: pick(locale, HEADING),
        blocks,
        footerLines: OPERATOR_FOOTER[locale],
      }),
    };
  },
};
