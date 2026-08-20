import { NOTIFICATION_LOCALES, type NotificationLocale } from '../interfaces/send-result.interface';

import { CAPACITY_MESSAGE_EN } from './budget-exhausted-consumer.template';
import { type RenderedTemplate, type TemplateContext } from './shared/template-context';
import {
  TEMPLATE_IDS,
  TEMPLATE_REGISTRY,
  TemplateId,
  isTemplateId,
  renderTemplate,
  type TemplatePropsMap,
} from './template-registry';

function context(locale: NotificationLocale): TemplateContext {
  return {
    locale,
    brandName: 'Drape',
    webUrl: 'https://drape.test',
    supportEmail: 'hello@drape.test',
    timeZone: 'Asia/Karachi',
  };
}

interface TemplateCase {
  readonly id: TemplateId;
  readonly render: (ctx: TemplateContext) => RenderedTemplate;
}

function testCase<K extends TemplateId>(id: K, props: TemplatePropsMap[K]): TemplateCase {
  return { id, render: (ctx) => TEMPLATE_REGISTRY[id].render(props, ctx) };
}

const AT = new Date('2026-08-04T09:30:00.000Z');

const CASES: readonly TemplateCase[] = [
  testCase(TemplateId.VERIFY_EMAIL, {
    verifyUrl: 'https://drape.test/verify?token=abc123',
    expiresInHours: 24,
  }),
  testCase(TemplateId.PASSWORD_RESET, {
    resetUrl: 'https://drape.test/reset?token=abc123',
    expiresInMinutes: 30,
  }),
  testCase(TemplateId.ADMIN_INVITE, {
    inviterName: 'Sana Yousuf',
    acceptUrl: 'https://drape.test/invite?token=abc123',
    expiresAt: AT,
  }),
  testCase(TemplateId.OTP_SMS, { code: '481920', expiresInMinutes: 10 }),
  testCase(TemplateId.NEW_ENQUIRY_ADMIN, {
    enquiryReference: 'ENQ-1042',
    consumerName: 'Hira Malik',
    eventType: 'Walima',
    eventDate: AT,
    budgetBand: 'PKR 250,000 – 500,000',
    itemCount: 3,
    garmentTitles: ['Ivory tissue lehenga', 'Gold organza sari', 'Deep red gharara'],
    submittedAt: AT,
    enquiryUrl: 'https://drape.test/admin/enquiries/1042',
  }),
  testCase(TemplateId.ENQUIRY_RECEIVED_CONSUMER, {
    consumerName: 'Hira',
    enquiryReference: 'ENQ-1042',
    garmentTitles: ['Ivory tissue lehenga', 'Gold organza sari'],
    enquiryUrl: 'https://drape.test/enquiries/1042',
  }),
  testCase(TemplateId.ENQUIRY_STATUS_CHANGED, {
    enquiryReference: 'ENQ-1042',
    previousStatus: 'NEW',
    currentStatus: 'CONTACTED',
    studioNote: 'We have the lehenga in ivory and can hold it for a week.',
    enquiryUrl: 'https://drape.test/enquiries/1042',
  }),
  testCase(TemplateId.BUDGET_WARNING_80, {
    period: '2026-08',
    usedGenerations: 1600,
    budgetGenerations: 2000,
    usedPercent: 80,
    warnPercent: 80,
    resetsAt: AT,
    usageUrl: 'https://drape.test/admin/usage',
  }),
  testCase(TemplateId.BUDGET_EXHAUSTED_ADMIN, {
    period: '2026-08',
    budgetGenerations: 2000,
    exhaustedAt: AT,
    resetsAt: AT,
    affectedConsumers: 12,
    settingsUrl: 'https://drape.test/admin/settings',
  }),
  testCase(TemplateId.BUDGET_EXHAUSTED_CONSUMER, {
    consumerName: 'Hira',
    shortlistUrl: 'https://drape.test/shortlist',
    enquiryUrl: 'https://drape.test/enquiries/new',
  }),
  testCase(TemplateId.ACCOUNT_APPROVED, {
    consumerName: 'Hira',
    signInUrl: 'https://drape.test/en/login',
  }),
  testCase(TemplateId.ACCOUNT_SUSPENDED, {
    consumerName: 'Hira',
    suspendedAt: AT,
    reason: 'Repeated uploads of photos that are not of the account holder.',
  }),
  testCase(TemplateId.ACCOUNT_DELETION_CONFIRMED, {
    consumerName: 'Hira',
    deletedAt: AT,
    photosDeleted: 2,
    tryOnsDeleted: 14,
    shareLinksRevoked: 1,
  }),
  testCase(TemplateId.RENDER_READY, {
    consumerName: 'Hira',
    garmentTitle: 'Ivory tissue lehenga',
    resultUrl: 'https://drape.test/results/9f21',
    tryOnsLeft: 7,
  }),
  testCase(TemplateId.SHARE_LINK_COMMENT, {
    consumerName: 'Hira',
    commenterName: 'Ammi',
    garmentTitle: 'Ivory tissue lehenga',
    comment: 'The neckline suits you better than the gold one.',
    commentedAt: AT,
    shareUrl: 'https://drape.test/share/9f21',
  }),
  testCase(TemplateId.MODERATION_BACKLOG_ALERT, {
    pendingCount: 41,
    overdueCount: 12,
    thresholdHours: 6,
    oldestPendingAt: AT,
    queueUrl: 'https://drape.test/admin/moderation',
  }),
  testCase(TemplateId.GENERATION_FAILURE_RATE_ALERT, {
    windowMinutes: 60,
    windowStartedAt: AT,
    totalGenerations: 210,
    failedGenerations: 14,
    failureRatePercent: 6.7,
    thresholdPercent: 4,
    topFailureReason: 'Upstream timeout',
    analyticsUrl: 'https://drape.test/admin/analytics',
  }),
  testCase(TemplateId.PURGE_JOB_FAILED, {
    jobName: 'photo-retention-purge',
    startedAt: AT,
    failedAt: AT,
    attempts: 3,
    pendingDeletions: 118,
    errorSummary: 'Storage root reported EBUSY on 118 keys.',
    retentionUrl: 'https://drape.test/admin/retention',
  }),
];

const BANNED_PHRASES = [
  'see yourself',
  'see exactly',
  'exactly how it',
  'your look',
  'true to life',
  'accurate',
  'guarantee',
  'perfect fit',
  'real fit',
  'final look',
  'preview of you',
  'sorry',
  'apolog',
];

describe('template registry', () => {
  it('registers every declared template id exactly once', () => {
    expect(TEMPLATE_IDS).toHaveLength(18);
    expect(new Set(TEMPLATE_IDS).size).toBe(TEMPLATE_IDS.length);
    expect(CASES.map((entry) => entry.id).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it('narrows known ids and rejects unknown ones', () => {
    expect(isTemplateId('RENDER_READY')).toBe(true);
    expect(isTemplateId('NOT_A_TEMPLATE')).toBe(false);
    expect(isTemplateId('toString')).toBe(false);
  });

  it('renders through the public entry point', () => {
    const rendered = renderTemplate(
      TemplateId.VERIFY_EMAIL,
      { verifyUrl: 'https://drape.test/verify?token=abc123', expiresInHours: 24 },
      context('EN'),
    );
    expect(rendered.subject).toBe('Confirm your email address');
    expect(rendered.html).toContain('Confirm email');
  });

  describe.each(NOTIFICATION_LOCALES)('locale %s', (locale) => {
    describe.each(CASES)('$id', (entry: TemplateCase) => {
      const rendered = entry.render(context(locale));

      it('produces a subject, an html body and a text body', () => {
        expect(rendered.subject.trim().length).toBeGreaterThan(0);
        expect(rendered.html.trim().length).toBeGreaterThan(0);
        expect(rendered.text.trim().length).toBeGreaterThan(0);
      });

      it('renders a complete html document with the brand header', () => {
        expect(rendered.html).toContain('<!doctype html>');
        expect(rendered.html).toContain('Drape');
        expect(rendered.html).toContain('</html>');
      });

      it('sets the direction and language for the locale', () => {
        const expectedDirection = locale === 'UR' ? 'rtl' : 'ltr';
        expect(rendered.html).toContain(`dir="${expectedDirection}"`);
        expect(rendered.html).toContain(`lang="${locale.toLowerCase()}"`);
      });

      it('leaves no unresolved interpolation', () => {
        expect(rendered.subject).not.toMatch(/\{\{|\}\}|undefined|NaN/);
        expect(rendered.text).not.toMatch(/\{\{|\}\}|undefined|NaN/);
      });

      it('passes the PRD §9.4 shortlisting check', () => {
        const haystack = `${rendered.subject}\n${rendered.text}`.toLowerCase();
        for (const phrase of BANNED_PHRASES) {
          expect(haystack).not.toContain(phrase);
        }
      });
    });
  });

  it('uses the PRD §8.3 capacity message verbatim, in html and in text', () => {
    const rendered = renderTemplate(
      TemplateId.BUDGET_EXHAUSTED_CONSUMER,
      {
        consumerName: 'Hira',
        shortlistUrl: 'https://drape.test/shortlist',
        enquiryUrl: 'https://drape.test/enquiries/new',
      },
      context('EN'),
    );

    expect(CAPACITY_MESSAGE_EN).toBe(
      "Our fitting room is at capacity today — we'll email you when it's back.",
    );
    expect(rendered.html).toContain(CAPACITY_MESSAGE_EN);
    expect(rendered.text).toContain(CAPACITY_MESSAGE_EN);
  });

  it('frames a finished render as a try-on and carries the shortlisting note', () => {
    const rendered = renderTemplate(
      TemplateId.RENDER_READY,
      {
        consumerName: 'Hira',
        garmentTitle: 'Ivory tissue lehenga',
        resultUrl: 'https://drape.test/results/9f21',
        tryOnsLeft: 7,
      },
      context('EN'),
    );

    expect(rendered.subject).toBe('Your try-on of Ivory tissue lehenga is ready');
    expect(rendered.text).toContain('approximate guide for shortlisting');
  });

  it('shows one honest word to a consumer for both closed outcomes', () => {
    const won = renderTemplate(
      TemplateId.ENQUIRY_STATUS_CHANGED,
      {
        enquiryReference: 'ENQ-1042',
        previousStatus: 'IN_DISCUSSION',
        currentStatus: 'CLOSED_WON',
        studioNote: null,
        enquiryUrl: 'https://drape.test/enquiries/1042',
      },
      context('EN'),
    );
    const lost = renderTemplate(
      TemplateId.ENQUIRY_STATUS_CHANGED,
      {
        enquiryReference: 'ENQ-1042',
        previousStatus: 'IN_DISCUSSION',
        currentStatus: 'CLOSED_LOST',
        studioNote: null,
        enquiryUrl: 'https://drape.test/enquiries/1042',
      },
      context('EN'),
    );

    expect(won.subject).toBe(lost.subject);
    expect(won.subject).toContain('closed');
    expect(won.text).not.toContain('won');
  });

  it('does not disclose whether an account exists', () => {
    const rendered = renderTemplate(
      TemplateId.PASSWORD_RESET,
      { resetUrl: 'https://drape.test/reset?token=abc123', expiresInMinutes: 30 },
      context('EN'),
    );
    expect(rendered.text).toContain('Someone asked to reset the password for this email address');
    expect(rendered.text.toLowerCase()).not.toContain('your account');
    expect(rendered.text.toLowerCase()).not.toContain('no account');
  });

  it('escapes untrusted content before it reaches the html body', () => {
    const rendered = renderTemplate(
      TemplateId.SHARE_LINK_COMMENT,
      {
        consumerName: 'Hira',
        commenterName: '<script>alert(1)</script>',
        garmentTitle: 'Ivory tissue lehenga',
        comment: '<img src=x onerror="alert(2)">',
        commentedAt: AT,
        shareUrl: 'https://drape.test/share/9f21',
      },
      context('EN'),
    );

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('never renders an href that is not http or https', () => {
    const rendered = renderTemplate(
      TemplateId.VERIFY_EMAIL,
      { verifyUrl: 'javascript:alert(1)', expiresInHours: 24 },
      context('EN'),
    );
    expect(rendered.html).not.toContain('href="javascript:');
    expect(rendered.html).not.toMatch(/<a\s/);
  });

  it('marks the OTP template as SMS and keeps its text to one sentence-length body', () => {
    expect(TEMPLATE_REGISTRY[TemplateId.OTP_SMS].channel).toBe('SMS');
    const rendered = renderTemplate(
      TemplateId.OTP_SMS,
      { code: '481920', expiresInMinutes: 10 },
      context('EN'),
    );
    expect(rendered.text).toBe(
      '481920 is your Drape code. It works for 10 minutes. Drape never asks you for this code.',
    );
    expect(rendered.text.length).toBeLessThanOrEqual(160);
  });
});
