import {
  NOTIFICATION_DIRECTION,
  type NotificationLocale,
} from '../../interfaces/send-result.interface';
import { escapeAttribute, escapeHtml, safeUrl, tidyText } from '../../utils/html.util';

/**
 * The one base layout every email template renders through.
 *
 * Design constraints, all forced by email clients rather than chosen:
 *  - table layout, inline styles, no external stylesheet, no web font, no remote image;
 *  - physical CSS properties, because Outlook does not support the logical ones the web app uses
 *    (docs/ARCHITECTURE.md §6.7 governs `frontend/`, not this);
 *  - RTL handled with `dir` plus a per-locale text alignment, so Urdu reads correctly;
 *  - a plain-text alternative generated from the *same* blocks, so the two can never drift.
 *
 * Colours are the light "Daylight" tokens from docs/ARCHITECTURE.md §6.1, written as hex because an
 * email cannot read a CSS custom property.
 */
const COLOR = {
  canvas: '#FBF8F3',
  surface: '#FFFFFF',
  surfaceSunken: '#F3EDE4',
  ink: '#1F1A16',
  inkMuted: '#6B5F55',
  inkSubtle: '#7C6F63',
  line: '#E4DACB',
  brand: '#71202F',
  brandFg: '#FFF7F2',
  brandTint: '#F6E8E9',
  goldText: '#6F4F14',
} as const;

const FONT_LTR = "'Manrope', 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_RTL = "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Segoe UI', Arial, sans-serif";

/** A body block. Templates compose these; they never hand-write HTML. */
export type EmailBlock =
  | { readonly type: 'lead'; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'button'; readonly label: string; readonly url: string }
  | { readonly type: 'link'; readonly label: string; readonly url: string }
  | { readonly type: 'code'; readonly value: string; readonly caption?: string }
  | {
      readonly type: 'facts';
      readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    }
  | { readonly type: 'list'; readonly items: readonly string[] }
  | { readonly type: 'quote'; readonly text: string; readonly attribution?: string }
  | { readonly type: 'note'; readonly text: string }
  | { readonly type: 'divider' };

export interface LayoutInput {
  readonly locale: NotificationLocale;
  readonly brandName: string;
  /** Shown in the inbox preview strip. Kept short and honest. */
  readonly preheader: string;
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  /** Replaces the default footer line, for operator alerts that are not consumer mail. */
  readonly footerLines?: readonly string[];
}

export interface RenderedBody {
  readonly html: string;
  readonly text: string;
}

/**
 * The footer states the shortlisting purpose on every consumer email, so PRD §9.4 check 4 is
 * satisfied structurally instead of one template at a time.
 */
const FOOTER_TAGLINE: Readonly<Record<NotificationLocale, string>> = {
  EN: 'Drape helps you shortlist bridal and formalwear before you visit a studio.',
  UR: 'Drape آپ کو اسٹوڈیو جانے سے پہلے دلہن اور فارمل ملبوسات شارٹ لسٹ کرنے میں مدد دیتا ہے۔',
};

const FOOTER_REASON: Readonly<Record<NotificationLocale, string>> = {
  EN: 'You are getting this because you have a Drape account.',
  UR: 'یہ ای میل آپ کو اس لیے موصول ہوئی کیونکہ آپ کا Drape اکاؤنٹ ہے۔',
};

function fontFor(locale: NotificationLocale): string {
  return NOTIFICATION_DIRECTION[locale] === 'rtl' ? FONT_RTL : FONT_LTR;
}

function alignFor(locale: NotificationLocale): 'left' | 'right' {
  return NOTIFICATION_DIRECTION[locale] === 'rtl' ? 'right' : 'left';
}

/** Nastaliq needs the extra vertical room (docs/ARCHITECTURE.md §6.1). */
function lineHeightFor(locale: NotificationLocale): string {
  return NOTIFICATION_DIRECTION[locale] === 'rtl' ? '2' : '1.6';
}

function renderBlockHtml(block: EmailBlock, locale: NotificationLocale): string {
  const align = alignFor(locale);
  const font = fontFor(locale);
  const leading = lineHeightFor(locale);
  const base = `margin:0 0 16px 0;font-family:${font};font-size:16px;line-height:${leading};text-align:${align};color:${COLOR.ink};`;

  switch (block.type) {
    case 'lead':
      return `<p style="${base}font-size:18px;color:${COLOR.ink};">${escapeHtml(block.text)}</p>`;

    case 'paragraph':
      return `<p style="${base}">${escapeHtml(block.text)}</p>`;

    case 'button': {
      const href = safeUrl(block.url);
      if (href === null) {
        return `<p style="${base}">${escapeHtml(block.label)}</p>`;
      }
      return [
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">`,
        `<tr><td align="${align}" bgcolor="${COLOR.brand}" style="border-radius:8px;">`,
        `<a href="${escapeAttribute(href)}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:600;line-height:1.2;color:${COLOR.brandFg};text-decoration:none;border-radius:8px;">${escapeHtml(block.label)}</a>`,
        `</td></tr></table>`,
      ].join('');
    }

    case 'link': {
      const href = safeUrl(block.url);
      if (href === null) {
        return `<p style="${base}">${escapeHtml(block.label)}</p>`;
      }
      return `<p style="${base}"><a href="${escapeAttribute(href)}" style="color:${COLOR.brand};text-decoration:underline;">${escapeHtml(block.label)}</a></p>`;
    }

    case 'code': {
      const caption =
        block.caption === undefined
          ? ''
          : `<p style="${base}font-size:14px;color:${COLOR.inkMuted};margin:0 0 8px 0;">${escapeHtml(block.caption)}</p>`;
      return [
        caption,
        `<p style="margin:0 0 24px 0;padding:16px 20px;background-color:${COLOR.surfaceSunken};border-radius:8px;font-family:'IBM Plex Mono',Consolas,monospace;font-size:26px;letter-spacing:6px;line-height:1.3;text-align:center;color:${COLOR.ink};">${escapeHtml(block.value)}</p>`,
      ].join('');
    }

    case 'facts': {
      const rows = block.rows
        .map(
          (row) =>
            `<tr>` +
            `<td style="padding:8px 0;font-family:${font};font-size:14px;line-height:1.5;color:${COLOR.inkMuted};text-align:${align};white-space:nowrap;">${escapeHtml(row.label)}</td>` +
            `<td style="padding:8px 0 8px 16px;font-family:${font};font-size:15px;line-height:1.5;color:${COLOR.ink};text-align:${align};">${escapeHtml(row.value)}</td>` +
            `</tr>`,
        )
        .join('');
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" dir="${NOTIFICATION_DIRECTION[locale]}" style="width:100%;margin:0 0 24px 0;border-top:1px solid ${COLOR.line};border-bottom:1px solid ${COLOR.line};">${rows}</table>`;
    }

    case 'list': {
      const items = block.items
        .map(
          (item) =>
            `<li style="margin:0 0 8px 0;font-family:${font};font-size:16px;line-height:${leading};color:${COLOR.ink};">${escapeHtml(item)}</li>`,
        )
        .join('');
      const padSide = align === 'right' ? 'padding:0 20px 0 0;' : 'padding:0 0 0 20px;';
      return `<ul style="margin:0 0 24px 0;${padSide}text-align:${align};">${items}</ul>`;
    }

    case 'quote': {
      const borderSide = align === 'right' ? 'border-right' : 'border-left';
      const padSide = align === 'right' ? 'padding:4px 16px 4px 0;' : 'padding:4px 0 4px 16px;';
      const attribution =
        block.attribution === undefined
          ? ''
          : `<span style="display:block;margin-top:8px;font-size:14px;color:${COLOR.inkMuted};">${escapeHtml(block.attribution)}</span>`;
      return `<blockquote style="margin:0 0 24px 0;${padSide}${borderSide}:3px solid ${COLOR.brandTint};font-family:${font};font-size:16px;line-height:${leading};text-align:${align};color:${COLOR.ink};">${escapeHtml(block.text)}${attribution}</blockquote>`;
    }

    case 'note':
      return `<p style="margin:0 0 16px 0;padding:12px 16px;background-color:${COLOR.brandTint};border-radius:8px;font-family:${font};font-size:14px;line-height:${leading};text-align:${align};color:${COLOR.goldText};">${escapeHtml(block.text)}</p>`;

    case 'divider':
      return `<hr style="margin:0 0 24px 0;border:0;border-top:1px solid ${COLOR.line};" />`;

    default:
      return assertNeverBlock(block);
  }
}

function assertNeverBlock(block: never): string {
  throw new TypeError(`Unhandled email block: ${JSON.stringify(block)}`);
}

function renderBlockText(block: EmailBlock): string {
  switch (block.type) {
    case 'lead':
    case 'paragraph':
    case 'note':
      return block.text;

    case 'button':
    case 'link':
      return `${block.label}: ${block.url}`;

    case 'code':
      return block.caption === undefined ? block.value : `${block.caption}\n${block.value}`;

    case 'facts':
      return block.rows.map((row) => `${row.label}: ${row.value}`).join('\n');

    case 'list':
      return block.items.map((item) => `- ${item}`).join('\n');

    case 'quote':
      return block.attribution === undefined
        ? `"${block.text}"`
        : `"${block.text}"\n— ${block.attribution}`;

    case 'divider':
      return '---';

    default:
      return assertNeverBlock(block);
  }
}

/** Renders the shared shell plus the blocks, and the matching plain-text alternative. */
export function renderLayout(input: LayoutInput): RenderedBody {
  const { locale, brandName, preheader, heading, blocks } = input;
  const direction = NOTIFICATION_DIRECTION[locale];
  const align = alignFor(locale);
  const font = fontFor(locale);
  const footerLines = input.footerLines ?? [FOOTER_TAGLINE[locale], FOOTER_REASON[locale]];

  const body = blocks.map((block) => renderBlockHtml(block, locale)).join('\n        ');
  const footer = footerLines
    .map(
      (line) =>
        `<p style="margin:0 0 6px 0;font-family:${font};font-size:12px;line-height:1.6;text-align:${align};color:${COLOR.inkSubtle};">${escapeHtml(line)}</p>`,
    )
    .join('\n          ');

  const html = `<!doctype html>
<html lang="${locale.toLowerCase()}" dir="${direction}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${COLOR.canvas};" dir="${direction}">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLOR.canvas};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:${COLOR.surface};border:1px solid ${COLOR.line};border-radius:16px;overflow:hidden;" dir="${direction}">
            <tr>
              <td style="padding:24px 32px;background-color:${COLOR.brand};text-align:${align};">
                <span style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:0.5px;color:${COLOR.brandFg};">${escapeHtml(brandName)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 20px 0;font-family:'Fraunces',Georgia,serif;font-size:24px;font-weight:600;line-height:1.35;text-align:${align};color:${COLOR.ink};">${escapeHtml(heading)}</h1>
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px 32px;background-color:${COLOR.surfaceSunken};border-top:1px solid ${COLOR.line};">
          ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = tidyText(
    [
      brandName,
      '',
      heading,
      '',
      ...blocks.map((block) => renderBlockText(block)),
      '',
      '---',
      ...footerLines,
    ].join('\n\n'),
  );

  return { html, text };
}
