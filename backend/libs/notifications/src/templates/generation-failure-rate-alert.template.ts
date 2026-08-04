import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { OPERATOR_FOOTER, type LocalisedString } from './shared/copy';
import { formatDateTime, formatNumber, formatPercent, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface GenerationFailureRateAlertProps {
  /** Length of the measurement window in minutes. */
  readonly windowMinutes: number;
  readonly windowStartedAt: Date;
  readonly totalGenerations: number;
  readonly failedGenerations: number;
  /** Observed failure rate, 0–100. */
  readonly failureRatePercent: number;
  /** Alert threshold, 0–100. E-14 sets it at 4. */
  readonly thresholdPercent: number;
  /** Most common failure reason in the window, already translated by the caller. */
  readonly topFailureReason: string | null;
  /** Admin analytics page the API built. */
  readonly analyticsUrl: string;
}

/** Operator alert, E-14. */
const SUBJECT: Readonly<Record<NotificationLocale, (rate: string) => string>> = {
  EN: (rate) => `Try-on failure rate is ${rate}`,
  UR: (rate) => `ٹرائی آن ناکامی کی شرح ${rate} ہے`,
};

const HEADING: LocalisedString = {
  EN: 'Try-ons are failing more than usual',
  UR: 'ٹرائی آن معمول سے زیادہ ناکام ہو رہی ہیں',
};

const PREHEADER: LocalisedString = {
  EN: 'Check the upstream provider before consumers notice.',
  UR: 'صارفین کے محسوس کرنے سے پہلے اپ اسٹریم فراہم کنندہ کو دیکھیں۔',
};

const LEAD: Readonly<
  Record<NotificationLocale, (failed: string, total: string, minutes: string) => string>
> = {
  EN: (failed, total, minutes) =>
    `${failed} of ${total} generations failed in the last ${minutes} minutes.`,
  UR: (failed, total, minutes) =>
    `پچھلے ${minutes} منٹ میں ${total} میں سے ${failed} جنریشن ناکام ہوئیں۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    window: 'Window started',
    total: 'Generations',
    failed: 'Failed',
    rate: 'Failure rate',
    threshold: 'Alert threshold',
    reason: 'Most common reason',
    none: 'Not identified',
  },
  UR: {
    window: 'وقفہ شروع ہوا',
    total: 'جنریشن',
    failed: 'ناکام',
    rate: 'ناکامی کی شرح',
    threshold: 'الرٹ کی حد',
    reason: 'سب سے عام وجہ',
    none: 'معلوم نہیں ہو سکی',
  },
};

const IMPACT: LocalisedString = {
  EN: 'Failed generations consume no quota and no budget, so consumers are not charged — but they are waiting and seeing errors.',
  UR: 'ناکام جنریشن کوٹا یا بجٹ خرچ نہیں کرتیں، اس لیے صارفین سے کچھ نہیں کٹتا — لیکن وہ انتظار کر رہے ہیں اور انہیں خرابی نظر آ رہی ہے۔',
};

const ACTION: LocalisedString = {
  EN: 'Check the upstream provider status, then follow the failure-rate steps in the runbook.',
  UR: 'اپ اسٹریم فراہم کنندہ کی حالت دیکھیں، پھر رن بک میں ناکامی کی شرح والے مراحل پر عمل کریں۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open analytics',
  UR: 'اینالیٹکس کھولیں',
};

export const generationFailureRateAlertTemplate: TemplateDefinition<GenerationFailureRateAlertProps> =
  {
    channel: 'EMAIL',
    audience: 'ADMIN',
    render: (props, context: TemplateContext): RenderedTemplate => {
      const { locale } = context;
      const labels = LABELS[locale];
      const rate = formatPercent(props.failureRatePercent, context);

      const blocks: EmailBlock[] = [
        {
          type: 'lead',
          text: pick(locale, LEAD)(
            formatNumber(props.failedGenerations, context),
            formatNumber(props.totalGenerations, context),
            formatNumber(props.windowMinutes, context),
          ),
        },
        {
          type: 'facts',
          rows: [
            { label: labels.window, value: formatDateTime(props.windowStartedAt, context) },
            { label: labels.total, value: formatNumber(props.totalGenerations, context) },
            { label: labels.failed, value: formatNumber(props.failedGenerations, context) },
            { label: labels.rate, value: rate },
            { label: labels.threshold, value: formatPercent(props.thresholdPercent, context) },
            { label: labels.reason, value: props.topFailureReason ?? labels.none },
          ],
        },
        { type: 'paragraph', text: pick(locale, IMPACT) },
        { type: 'paragraph', text: pick(locale, ACTION) },
        { type: 'button', label: pick(locale, BUTTON), url: props.analyticsUrl },
      ];

      return {
        subject: pick(locale, SUBJECT)(rate),
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
