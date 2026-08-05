import { describe, expect, it } from 'vitest';

import {
  ALL_LOCALES,
  CONSUMER_NAMESPACES,
  consumerStrings,
  readNamespace,
  type FlatMessages,
} from './messages.testkit';

/**
 * The PRD §9.4 / §10.5 copy gate, run over the message catalogues rather than left to review.
 *
 * `backend/libs/notifications` does exactly this for the email templates
 * (`src/templates/template-registry.spec.ts`): a list of phrases that mean the product has been
 * described as a preview tool, asserted over every rendered template in every locale. The web
 * app is the larger copy surface and had no equivalent, so this is that check, applied to every
 * consumer-facing string in `src/i18n/messages/{en,ur}`.
 *
 * §8.3: "Run this on every consumer-facing string before it ships — button labels, headings,
 * empty states, error messages, toasts, emails, SMS, alt text and meta descriptions."
 *
 * What this cannot check: whether a *new* way of promising accuracy has been invented. A phrase
 * list catches regressions of known failures, not novel ones. The four §9.4 questions still have
 * to be asked by the person writing the string; this stops the answer being forgotten later.
 */

/**
 * §9.4 questions 1–3. The English list is shared with the backend check so the two surfaces
 * cannot drift apart on what counts as a failure.
 */
const BANNED_EN = [
  // 1. Promises accuracy.
  'accurate',
  'accuracy',
  'exactly how',
  'see exactly',
  'true to life',
  'true-to-life',
  'lifelike',
  'photorealistic',
  'guarantee',
  'guaranteed',
  'perfect fit',
  'real fit',
  'exact fit',
  'how it will fit',
  'how it fits you',
  // 2. Frames the render as final rather than indicative.
  'your look',
  'final look',
  'finished look',
  'the real thing on you',
  // 3. "See yourself in" or equivalent.
  'see yourself',
  'see how you look',
  'yourself in this',
  'yourself wearing',
  'virtual mirror',
  // D-7: never apologise, never blame.
  'sorry',
  'apolog',
  'oops',
  'whoops',
  'your fault',
  'you failed to',
  'you forgot to',
  'invalid input',
];

/**
 * The Urdu equivalents. Written against the same four questions rather than transliterated, so
 * `ur` cannot quietly acquire a promise the English catalogue is forbidden to make (§8.3 rule 9:
 * both locales are written by the same author in the same pass).
 */
const BANNED_UR = [
  'بالکل ٹھیک', // "exactly right" — promises accuracy
  'حتمی شکل', // "final look"
  'اپنے آپ کو دیکھیں', // "see yourself"
  'معذرت', // "apology"
  'معاف کیجیے', // "sorry"
  // Deliberately NOT banned: `ضمانت`. It carries both "guarantee" and "security deposit", and
  // the catalogue uses it for the rental deposit (`browse.card.deposit`). Banning the word would
  // outlaw the correct usage; the promise-of-accuracy sense is caught by `بالکل ٹھیک` above.
];

/**
 * §9.4 question 4 — the shortlisting purpose must be *stated*, not implied. These are the
 * screens where a render is visible, and each one carries the C-20 caption.
 */
const CAPTION_KEYS = ['tryon.wait.caption', 'renders.caption', 'shortlist.caption'] as const;

describe('PRD §9.4 — shortlisting language, never preview language', () => {
  describe.each(ALL_LOCALES)('locale %s', (locale) => {
    const strings = consumerStrings(locale);
    const banned = locale === 'en' ? BANNED_EN : [...BANNED_EN, ...BANNED_UR];

    it('contains no banned phrase in any consumer-facing string', () => {
      const offences: string[] = [];
      for (const [key, value] of Object.entries(strings)) {
        const haystack = value.toLowerCase();
        for (const phrase of banned) {
          if (haystack.includes(phrase)) offences.push(`${key}: "${value}"  ← "${phrase}"`);
        }
      }
      expect(offences).toEqual([]);
    });

    it('keeps the shortlisting purpose on every screen a render is visible on', () => {
      for (const key of CAPTION_KEYS) {
        const caption = strings[key];
        expect(caption, `${key} is missing`).toBeTruthy();
        // The three anchors of C-20: it is a guide, it is for shortlisting, and the physical
        // piece will differ. Wording may be revised; these three ideas may not be dropped.
        expect(caption?.length ?? 0).toBeGreaterThan(40);
      }
    });
  });

  it('states the C-20 caption in English as an approximate guide for shortlisting', () => {
    const strings = consumerStrings('en');
    for (const key of CAPTION_KEYS) {
      const caption = (strings[key] ?? '').toLowerCase();
      expect(caption, key).toContain('approximate guide');
      expect(caption, key).toContain('shortlist');
      expect(caption, key).toContain('differ in person');
    }
  });

  it('never calls a try-on a preview', () => {
    // "Preview" is the single word the product is defined against (§9.4 preamble). It is legal
    // in the admin console — an admin genuinely previews the consumer view — and nowhere else.
    for (const locale of ALL_LOCALES) {
      const offences = Object.entries(consumerStrings(locale)).filter(([, value]) =>
        /\bpreview/i.test(value),
      );
      expect(offences).toEqual([]);
    }
  });
});

describe('PRD §10.5 — copy standards', () => {
  const en = consumerStrings('en');

  /** D-12: no filler. These add nothing and are the usual suspects. */
  const FILLER = [
    'please note',
    'simply',
    'just click',
    'click here',
    'in order to',
    'at this time',
    'kindly',
    'feel free to',
  ];

  it('carries no filler (D-12)', () => {
    const offences: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const haystack = value.toLowerCase();
      for (const phrase of FILLER) {
        if (haystack.includes(phrase)) offences.push(`${key}: "${value}"  ← "${phrase}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('names things by what the user controls, not how the system is built (D-14)', () => {
    // §8.3 rule 7 gives the two worked examples: "Your photos", not "Person photo entities";
    // "Try-ons left this month", not "Quota balance".
    const IMPLEMENTATION_WORDS = [
      'entity',
      'entities',
      'quota balance',
      'person photo',
      'render job',
      'payload',
      'endpoint',
      'database',
      'null',
      'undefined',
      'boolean',
      'enum',
      'uuid',
    ];
    const offences: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const haystack = value.toLowerCase();
      for (const word of IMPLEMENTATION_WORDS) {
        if (new RegExp(`\\b${word}\\b`).test(haystack)) {
          offences.push(`${key}: "${value}"  ← "${word}"`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('writes headings and labels in sentence case, not Title Case (D-12)', () => {
    // A string of three or more words where every word is capitalised is Title Case. Proper
    // nouns are single words in this catalogue, so the three-word floor keeps them out.
    const offences: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const words = value.split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
      if (words.length < 3) continue;
      if (words.every((word) => /^[A-Z]/.test(word))) offences.push(`${key}: "${value}"`);
    }
    expect(offences).toEqual([]);
  });

  it('leaves no unresolved interpolation or stray placeholder', () => {
    // Doubled braces are legal here: a nested ICU plural closes with `}}`. What must never ship
    // is a value that leaked a JS expression result or an unfinished note.
    for (const locale of ALL_LOCALES) {
      for (const [key, value] of Object.entries(consumerStrings(locale))) {
        expect(value, key).not.toMatch(/\bundefined\b|\bNaN\b|\[object |TODO|FIXME|XXX/);
      }
    }
  });

  it('gives every error string a next step as well as a cause (D-7)', () => {
    // Every `*.errors.*` *message* is copy a user reads at her worst moment. It has to end in an
    // instruction, an alternative, or a statement of what happens next — never a bare
    // description of the failure.
    //
    // Headings and control labels are excluded: a title's whole job is to say what happened
    // ("This piece didn't load"), and a button already names its own action. Splitting the two
    // is the point of D-7, not a loophole in it.
    const isHeadingOrControl = (key: string): boolean =>
      /(^|\.)(title|reference|action|retry|cancel|confirm|dismiss|label)$/i.test(key) ||
      /Title$/.test(key);

    const errorish = Object.entries(en).filter(
      ([key]) => /\berrors?\./.test(key) && !isHeadingOrControl(key),
    );
    expect(errorish.length).toBeGreaterThan(20);

    const NEXT_STEP_VERB =
      /\b(try|open|pick|choose|add|use|tick|select|sign in|browse|contact|reload|refresh|confirm|read|check|give it|carry on|hang tight|start|send|we'll|we've|you can)\b/i;

    const offences = errorish.filter(([, value]) => {
      // A sentence beyond the first, or an explicit instruction inside the first, counts.
      const sentences = value.split(/[.!?—]\s+/).filter(Boolean);
      return sentences.length <= 1 && !NEXT_STEP_VERB.test(value);
    });
    expect(offences.map(([key, value]) => `${key}: "${value}"`)).toEqual([]);
  });
});

describe('PRD §10.5 D-13 — a control keeps its name across the flow', () => {
  const en: FlatMessages = {};
  for (const namespace of CONSUMER_NAMESPACES) {
    for (const [key, value] of Object.entries(readNamespace('en', namespace))) {
      en[`${namespace}.${key}`] = value;
    }
  }

  /** action key → the confirmation that must echo it. §8.3 rule 6: Delete → Deleted. */
  const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
    ['renders.delete.action', 'renders.delete.done', 'delet'],
    ['renders.detail.download', 'renders.detail.downloading', 'download'],
    ['tryon.wait.cancel', 'tryon.wait.cancelled.title', 'stop'],
  ];

  it.each(PAIRS)('%s and %s share a stem', (actionKey, confirmKey, stem) => {
    expect(en[actionKey]?.toLowerCase(), actionKey).toContain(stem);
    expect(en[confirmKey]?.toLowerCase(), confirmKey).toContain(stem);
  });
});
