import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { OPERATOR_FOOTER, type LocalisedString } from './shared/copy';
import { formatDate, formatNumber, formatPercent, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface BudgetWarning80Props {
  /** Ledger period, e.g. `2026-08`. */
  readonly period: string;
  readonly usedGenerations: number;
  readonly budgetGenerations: number;
  /** Percentage used, 0–100. */
  readonly usedPercent: number;
  /** `BUDGET_WARN_PERCENT`. */
  readonly warnPercent: number;
  /** When the next period starts and the budget resets. */
  readonly resetsAt: Date;
  /** Admin usage page the API built. */
  readonly usageUrl: string;
}

/** Operator alert, A-29 / E-14. States what happened and what to do next (D-7). */
const SUBJECT: Readonly<Record<NotificationLocale, (percent: string) => string>> = {
  EN: (percent) => `Try-on budget is at ${percent}`,
  UR: (percent) => `ٹرائی آن بجٹ ${percent} پر ہے`,
};

const HEADING: LocalisedString = {
  EN: 'The monthly try-on budget is running down',
  UR: 'ماہانہ ٹرائی آن بجٹ کم ہو رہا ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Raise the budget or let it reset.',
  UR: 'بجٹ بڑھائیں یا اسے ری سیٹ ہونے دیں۔',
};

const LEAD: Readonly<
  Record<NotificationLocale, (used: string, budget: string, percent: string) => string>
> = {
  EN: (used, budget, percent) =>
    `The studio has used ${used} of ${budget} generations this period — ${percent}.`,
  UR: (used, budget, percent) =>
    `اس مدت میں اسٹوڈیو ${budget} میں سے ${used} جنریشن استعمال کر چکا ہے — ${percent}۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    period: 'Period',
    used: 'Used',
    budget: 'Budget',
    remaining: 'Left',
    threshold: 'Alert threshold',
    resets: 'Resets',
  },
  UR: {
    period: 'مدت',
    used: 'استعمال شدہ',
    budget: 'بجٹ',
    remaining: 'باقی',
    threshold: 'الرٹ کی حد',
    resets: 'ری سیٹ',
  },
};

const CONSEQUENCE: LocalisedString = {
  EN: 'At 100% consumers stop being able to generate try-ons and see the capacity message instead.',
  UR: '100% پر صارفین ٹرائی آن نہیں بنا سکیں گے اور انہیں گنجائش والا پیغام نظر آئے گا۔',
};

const ACTION: LocalisedString = {
  EN: 'Raise the monthly budget in Settings, or leave it and let the period reset.',
  UR: 'سیٹنگز میں ماہانہ بجٹ بڑھائیں، یا اسے چھوڑ دیں اور مدت کو ری سیٹ ہونے دیں۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open usage',
  UR: 'استعمال کھولیں',
};

export const budgetWarning80Template: TemplateDefinition<BudgetWarning80Props> = {
  channel: 'EMAIL',
  audience: 'ADMIN',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const labels = LABELS[locale];
    const percent = formatPercent(props.usedPercent, context);
    const remaining = Math.max(0, props.budgetGenerations - props.usedGenerations);

    const blocks: EmailBlock[] = [
      {
        type: 'lead',
        text: pick(locale, LEAD)(
          formatNumber(props.usedGenerations, context),
          formatNumber(props.budgetGenerations, context),
          percent,
        ),
      },
      {
        type: 'facts',
        rows: [
          { label: labels.period, value: props.period },
          { label: labels.used, value: formatNumber(props.usedGenerations, context) },
          { label: labels.budget, value: formatNumber(props.budgetGenerations, context) },
          { label: labels.remaining, value: formatNumber(remaining, context) },
          { label: labels.threshold, value: formatPercent(props.warnPercent, context) },
          { label: labels.resets, value: formatDate(props.resetsAt, context) },
        ],
      },
      { type: 'paragraph', text: pick(locale, CONSEQUENCE) },
      { type: 'paragraph', text: pick(locale, ACTION) },
      { type: 'button', label: pick(locale, BUTTON), url: props.usageUrl },
    ];

    return {
      subject: pick(locale, SUBJECT)(percent),
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
