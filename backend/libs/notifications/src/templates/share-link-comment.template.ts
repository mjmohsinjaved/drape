import { type NotificationLocale } from '../interfaces/send-result.interface';

import { renderLayout, type EmailBlock } from './layout/base-layout';
import { type LocalisedString } from './shared/copy';
import { formatDateTime, pick } from './shared/format';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';

export interface ShareLinkCommentProps {
  readonly consumerName: string;
  /** Name the voter typed on the public share page. Untrusted input — the layout escapes it. */
  readonly commenterName: string;
  readonly garmentTitle: string;
  /** The comment itself. Untrusted input — the layout escapes it. */
  readonly comment: string;
  readonly commentedAt: Date;
  /** The consumer's own view of the shared shortlist. */
  readonly shareUrl: string;
}

/** Someone the consumer shared with left a comment (C-30). */
const SUBJECT: Readonly<Record<NotificationLocale, (commenter: string) => string>> = {
  EN: (commenter) => `${commenter} commented on your shortlist`,
  UR: (commenter) => `${commenter} نے آپ کی شارٹ لسٹ پر تبصرہ کیا`,
};

const HEADING: LocalisedString = {
  EN: 'You have a comment on your shortlist',
  UR: 'آپ کی شارٹ لسٹ پر ایک تبصرہ آیا ہے',
};

const PREHEADER: LocalisedString = {
  EN: 'Read it and see what the rest of the group thinks.',
  UR: 'اسے پڑھیں اور دیکھیں کہ باقی لوگ کیا سوچتے ہیں۔',
};

const LEAD: Readonly<Record<NotificationLocale, (commenter: string, garment: string) => string>> = {
  EN: (commenter, garment) => `${commenter} commented on ${garment} in the shortlist you shared.`,
  UR: (commenter, garment) =>
    `${commenter} نے آپ کی شیئر کی ہوئی شارٹ لسٹ میں ${garment} پر تبصرہ کیا ہے۔`,
};

const WHEN_LABEL: Readonly<Record<NotificationLocale, string>> = {
  EN: 'Commented',
  UR: 'تبصرے کا وقت',
};

const CLOSING: LocalisedString = {
  EN: "Comments only reach you. The people you shared with cannot see each other's notes.",
  UR: 'تبصرے صرف آپ تک پہنچتے ہیں۔ جن لوگوں سے آپ نے شیئر کیا وہ ایک دوسرے کے تبصرے نہیں دیکھ سکتے۔',
};

const BUTTON: LocalisedString = {
  EN: 'Open shortlist',
  UR: 'شارٹ لسٹ کھولیں',
};

export const shareLinkCommentTemplate: TemplateDefinition<ShareLinkCommentProps> = {
  channel: 'EMAIL',
  audience: 'CONSUMER',
  render: (props, context: TemplateContext): RenderedTemplate => {
    const { locale } = context;
    const blocks: EmailBlock[] = [
      { type: 'paragraph', text: `${props.consumerName},` },
      { type: 'lead', text: pick(locale, LEAD)(props.commenterName, props.garmentTitle) },
      { type: 'quote', text: props.comment, attribution: props.commenterName },
      {
        type: 'facts',
        rows: [{ label: WHEN_LABEL[locale], value: formatDateTime(props.commentedAt, context) }],
      },
      { type: 'button', label: pick(locale, BUTTON), url: props.shareUrl },
      { type: 'paragraph', text: pick(locale, CLOSING) },
    ];

    return {
      subject: pick(locale, SUBJECT)(props.commenterName),
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
