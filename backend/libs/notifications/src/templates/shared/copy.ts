import { type NotificationLocale } from '../../interfaces/send-result.interface';

/**
 * Copy shared across templates.
 *
 * Every string here has been through the PRD §9.4 / §10.5 check: shortlisting language, active
 * voice, sentence case, plain verbs, no filler, no apology, no blame. English and Urdu were written
 * together in one pass (docs/ARCHITECTURE.md §8.3 item 9).
 */
export type LocalisedString = Readonly<Record<NotificationLocale, string>>;

/**
 * The email form of the C-20 shortlisting caption. It appears on every message that shows or links
 * to a render, so a try-on is never framed as a final look.
 */
export const SHORTLISTING_NOTE: LocalisedString = {
  EN: 'A try-on is an approximate guide for shortlisting. Fabric fall, embroidery detail and length differ in person.',
  UR: 'ٹرائی آن شارٹ لسٹ بنانے کے لیے ایک تخمینی رہنمائی ہے۔ کپڑے کا گرنا، کڑھائی کی تفصیل اور لمبائی سامنے دیکھنے پر مختلف ہوں گی۔',
};

/** Used wherever a link is time-limited and the reader did not ask for it. */
export const IGNORE_IF_UNEXPECTED: LocalisedString = {
  EN: 'If you did not ask for this, ignore this email. Nothing changes until the link is used.',
  UR: 'اگر آپ نے یہ نہیں مانگا تو اس ای میل کو نظر انداز کر دیں۔ لنک استعمال ہونے تک کچھ نہیں بدلتا۔',
};

/** Fallback when a button does not open. */
export const BUTTON_FALLBACK: LocalisedString = {
  EN: 'If the button does not open, copy this link into your browser:',
  UR: 'اگر بٹن نہ کھلے تو یہ لنک اپنے براؤزر میں کاپی کریں:',
};

/**
 * Footer for messages sent to an address before any account is confirmed.
 *
 * S-6: the default footer says "you have a Drape account", which would confirm an account exists to
 * anyone who typed the address into a reset form. Verification and reset mail uses this instead.
 */
export const NEUTRAL_FOOTER: Readonly<Record<NotificationLocale, readonly string[]>> = {
  EN: [
    'Drape helps you shortlist bridal and formalwear before you visit a studio.',
    'This message went to the address entered on the Drape sign-in page.',
  ],
  UR: [
    'Drape آپ کو اسٹوڈیو جانے سے پہلے دلہن اور فارمل ملبوسات شارٹ لسٹ کرنے میں مدد دیتا ہے۔',
    'یہ پیغام اس پتے پر بھیجا گیا جو Drape کے سائن اِن صفحے پر درج کیا گیا تھا۔',
  ],
};

/** Footer used by operator alerts. They are not consumer mail and carry no marketing line. */
export const OPERATOR_FOOTER: Readonly<Record<NotificationLocale, readonly string[]>> = {
  EN: [
    'Drape sent this alert to the studio admins.',
    'The response steps live in docs/RUNBOOK.md.',
  ],
  UR: [
    'Drape نے یہ الرٹ اسٹوڈیو ایڈمنز کو بھیجا ہے۔',
    'جواب دینے کے مراحل docs/RUNBOOK.md میں درج ہیں۔',
  ],
};

/** Consumer-facing enquiry status labels, named by what the consumer sees (D-14). */
export const ENQUIRY_STATUS_LABEL: Readonly<
  Record<'NEW' | 'CONTACTED' | 'IN_DISCUSSION' | 'CLOSED_WON' | 'CLOSED_LOST', LocalisedString>
> = {
  NEW: { EN: 'New', UR: 'نئی' },
  CONTACTED: { EN: 'Contacted', UR: 'رابطہ ہو گیا' },
  IN_DISCUSSION: { EN: 'In discussion', UR: 'بات چیت جاری' },
  // Won and lost are the studio's own bookkeeping. A consumer sees one honest word for both.
  CLOSED_WON: { EN: 'Closed', UR: 'بند' },
  CLOSED_LOST: { EN: 'Closed', UR: 'بند' },
};

export type EnquiryStatusName = keyof typeof ENQUIRY_STATUS_LABEL;
