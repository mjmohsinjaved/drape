import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { OPERATOR_FOOTER, type LocalisedString } from './shared/copy';
import { formatDateTime, formatNumber, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface PurgeJobFailedProps {
  /** Cron job name, e.g. `photo-retention-purge`. */
  readonly jobName: string;
  readonly startedAt: Date;
  readonly failedAt: Date;
  readonly attempts: number;
  /** Rows still waiting to be deleted. */
  readonly pendingDeletions: number;
  /** Operator-facing error summary. Already redacted by the caller. */
  readonly errorSummary: string;
  /** Admin retention page the API built. */
  readonly retentionUrl: string;
}

/**
 * Operator alert, E-14 / E-17.
 *
 * Retention failure is a privacy commitment missed (§9.3), so the copy says that plainly rather
 * than treating it as an ordinary job error.
 */
const SUBJECT: Readonly<Record<NotificationLocale, (job: string) => string>> = {
  EN: (job) => `Purge job ${job} failed`,
  UR: (job) => `پرج جاب ${job} ناکام ہو گئی`,
};

const HEADING: LocalisedString = {
  EN: 'The purge job failed',
  UR: 'پرج جاب ناکام ہو گئی',
};

const PREHEADER: LocalisedString = {
  EN: 'Data we promised to delete is still stored.',
  UR: 'جو ڈیٹا حذف کرنے کا وعدہ تھا وہ اب بھی محفوظ ہے۔',
};

const LEAD: Readonly<Record<NotificationLocale, (job: string, attempts: string) => string>> = {
  EN: (job, attempts) => `${job} failed after ${attempts} attempts and deleted nothing further.`,
  UR: (job, attempts) => `${job} ${attempts} کوششوں کے بعد ناکام ہو گئی اور مزید کچھ حذف نہیں کیا۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    job: 'Job',
    started: 'Started',
    failed: 'Failed',
    attempts: 'Attempts',
    pending: 'Records still stored',
  },
  UR: {
    job: 'جاب',
    started: 'شروع ہوئی',
    failed: 'ناکام ہوئی',
    attempts: 'کوششیں',
    pending: 'اب بھی محفوظ ریکارڈ',
  },
};

const ERROR_HEADING: LocalisedString = {
  EN: 'What the job reported',
  UR: 'جاب نے کیا بتایا',
};

const IMPACT: LocalisedString = {
  EN: 'Photos and records past their retention window are still stored. That is a privacy commitment we have not met until the job runs clean.',
  UR: 'جن تصاویر اور ریکارڈز کی مدت گزر چکی ہے وہ اب بھی محفوظ ہیں۔ جب تک جاب صحیح نہیں چلتی، یہ ہمارا ادھورا رازداری وعدہ ہے۔',
};

const ACTION: LocalisedString = {
  EN: 'Follow the purge-job failure steps in the runbook, then run the job again and confirm the queue clears.',
  UR: 'رن بک میں پرج جاب کی ناکامی والے مراحل پر عمل کریں، پھر جاب دوبارہ چلائیں اور تصدیق کریں کہ قطار صاف ہو گئی۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open retention',
  UR: 'ریٹینشن کھولیں',
};

export const purgeJobFailedTemplate: TemplateDefinition<PurgeJobFailedProps> = {
  channel: 'EMAIL',
  audience: 'ADMIN',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const labels = LABELS[locale];

    const blocks: EmailBlock[] = [
      {
        type: 'lead',
        text: pick(locale, LEAD)(props.jobName, formatNumber(props.attempts, context)),
      },
      {
        type: 'facts',
        rows: [
          { label: labels.job, value: props.jobName },
          { label: labels.started, value: formatDateTime(props.startedAt, context) },
          { label: labels.failed, value: formatDateTime(props.failedAt, context) },
          { label: labels.attempts, value: formatNumber(props.attempts, context) },
          { label: labels.pending, value: formatNumber(props.pendingDeletions, context) },
        ],
      },
      { type: 'paragraph', text: pick(locale, ERROR_HEADING) },
      { type: 'quote', text: props.errorSummary },
      { type: 'paragraph', text: pick(locale, IMPACT) },
      { type: 'paragraph', text: pick(locale, ACTION) },
      { type: 'button', label: pick(locale, BUTTON), url: props.retentionUrl },
    ];

    return {
      subject: pick(locale, SUBJECT)(props.jobName),
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
