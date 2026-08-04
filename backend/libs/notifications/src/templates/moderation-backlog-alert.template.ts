import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { OPERATOR_FOOTER, type LocalisedString } from './shared/copy';
import { formatDateTime, formatNumber, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface ModerationBacklogAlertProps {
  /** Items sitting in `moderation_items` at state `PENDING`. */
  readonly pendingCount: number;
  /** Items past the age threshold. */
  readonly overdueCount: number;
  /** Age at which an item counts as overdue. */
  readonly thresholdHours: number;
  /** When the oldest pending item arrived. */
  readonly oldestPendingAt: Date;
  /** Admin moderation queue the API built. */
  readonly queueUrl: string;
}

/** Operator alert, E-14. */
const SUBJECT: Readonly<Record<NotificationLocale, (count: string) => string>> = {
  EN: (count) => `Moderation queue has ${count} items waiting`,
  UR: (count) => `ماڈریشن قطار میں ${count} آئٹم منتظر ہیں`,
};

const HEADING: LocalisedString = {
  EN: 'The moderation queue is backing up',
  UR: 'ماڈریشن قطار جمع ہو رہی ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Consumers wait for a decision on their photo.',
  UR: 'صارفین اپنی تصویر پر فیصلے کے منتظر ہیں۔',
};

const LEAD: Readonly<Record<NotificationLocale, (overdue: string, hours: string) => string>> = {
  EN: (overdue, hours) => `${overdue} items have waited longer than ${hours} hours for a decision.`,
  UR: (overdue, hours) => `${overdue} آئٹم فیصلے کے لیے ${hours} گھنٹے سے زیادہ انتظار کر چکے ہیں۔`,
};

const LABELS: Readonly<Record<NotificationLocale, Readonly<Record<string, string>>>> = {
  EN: {
    pending: 'Waiting',
    overdue: 'Past the threshold',
    threshold: 'Threshold',
    oldest: 'Oldest arrived',
  },
  UR: {
    pending: 'زیرِ التوا',
    overdue: 'حد سے تجاوز',
    threshold: 'حد',
    oldest: 'سب سے پرانا آیا',
  },
};

const IMPACT: LocalisedString = {
  EN: 'A consumer cannot generate a try-on until their photo is decided, so every waiting item is a blocked account.',
  UR: 'جب تک صارف کی تصویر کا فیصلہ نہ ہو وہ ٹرائی آن نہیں بنا سکتا، اس لیے ہر منتظر آئٹم کا مطلب ایک رکا ہوا اکاؤنٹ ہے۔',
};

const ACTION: LocalisedString = {
  EN: 'Work the oldest items first. The queue sorts that way by default.',
  UR: 'سب سے پرانے آئٹمز پہلے نمٹائیں۔ قطار پہلے سے اسی ترتیب میں لگتی ہے۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open moderation queue',
  UR: 'ماڈریشن قطار کھولیں',
};

const HOURS: Readonly<Record<NotificationLocale, string>> = { EN: 'hours', UR: 'گھنٹے' };

export const moderationBacklogAlertTemplate: TemplateDefinition<ModerationBacklogAlertProps> = {
  channel: 'EMAIL',
  audience: 'ADMIN',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const labels = LABELS[locale];
    const thresholdHours = formatNumber(props.thresholdHours, context);

    const blocks: EmailBlock[] = [
      {
        type: 'lead',
        text: pick(locale, LEAD)(formatNumber(props.overdueCount, context), thresholdHours),
      },
      {
        type: 'facts',
        rows: [
          { label: labels.pending, value: formatNumber(props.pendingCount, context) },
          { label: labels.overdue, value: formatNumber(props.overdueCount, context) },
          { label: labels.threshold, value: `${thresholdHours} ${HOURS[locale]}` },
          { label: labels.oldest, value: formatDateTime(props.oldestPendingAt, context) },
        ],
      },
      { type: 'paragraph', text: pick(locale, IMPACT) },
      { type: 'paragraph', text: pick(locale, ACTION) },
      { type: 'button', label: pick(locale, BUTTON), url: props.queueUrl },
    ];

    return {
      subject: pick(locale, SUBJECT)(formatNumber(props.overdueCount, context)),
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
