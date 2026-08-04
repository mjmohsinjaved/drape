import { PolicyVersion } from '@api/modules/consents/entities/policy-version.entity';

import {
  readSeedInteger,
  type SeedContext,
  type SeedOutcome,
  type Seeder,
} from './seeder.contract';

/**
 * The initial consent policy version (C-11, C-12, §4.10).
 *
 * C-12 makes consent version-bound: a consumer's consent is current only while a
 * `consents` row exists for her against the policy version marked `isCurrent`. Publishing
 * a new version therefore re-gates everyone, which is exactly the intent — so a policy
 * version has to exist before the very first photo upload, and that is this seeder's job.
 *
 * The body below covers all five C-11 statements and passes the §8.3 copy check: it is a
 * shortlisting tool, it promises nothing about accuracy, and the English and Urdu were
 * written in the same pass rather than machine-translated afterwards (§8.3 rule 9).
 *
 * A later policy is published through `POST /api/v1/settings/policy`, never by editing
 * this file — the whole point of the table is that the text a consumer agreed to is
 * preserved exactly as she read it.
 */

/** Bumping this creates a *new* version; it never rewrites an existing one. */
const INITIAL_POLICY_VERSION = '2026.08.1';

export const policyVersionSeeder: Seeder = {
  name: 'policy-version',

  async run(context: SeedContext): Promise<SeedOutcome> {
    const repository = context.manager.getRepository(PolicyVersion);

    const existing = await repository.findOne({ where: { version: INITIAL_POLICY_VERSION } });
    if (existing !== null) {
      return {
        created: 0,
        skipped: 1,
        notes: [`Policy version ${INITIAL_POLICY_VERSION} already exists — left untouched.`],
      };
    }

    // `UQ_policy_versions_current` allows exactly one current row (§4.10). If some other
    // version is already current, this seeder is running against a database that has moved
    // on — insert as non-current rather than fight the index.
    const currentCount = await repository.count({ where: { isCurrent: true } });
    const isCurrent = currentCount === 0;

    const photoDays = readSeedInteger(context.env, 'PHOTO_RETENTION_DAYS', 30);

    await repository.save(
      repository.create({
        version: INITIAL_POLICY_VERSION,
        effectiveFrom: context.now,
        isCurrent,
        bodyEn: buildBodyEn(photoDays),
        bodyUr: buildBodyUr(photoDays),
        summaryEn: SUMMARY_EN,
        summaryUr: SUMMARY_UR,
        retentionSummary: { photoDays, rendersLifetime: true },
      }),
    );

    return {
      created: 1,
      skipped: 0,
      notes: isCurrent
        ? [
            `Policy ${INITIAL_POLICY_VERSION} is now the current version — consent is gated on it (C-12).`,
          ]
        : [
            `Policy ${INITIAL_POLICY_VERSION} inserted as NOT current: another version already holds that flag.`,
          ],
    };
  },
};

const SUMMARY_EN =
  'Your photo is used only to generate your own try-on images. The processing provider deletes it ' +
  'as soon as the image is generated and does not train on it. Studio staff cannot see your photo, ' +
  'and see a try-on only if you send it with an enquiry. You can delete your photo and results at ' +
  'any time, from any screen.';

const SUMMARY_UR =
  'آپ کی تصویر صرف آپ کے اپنے ٹرائی آن نتائج بنانے کے لیے استعمال ہوتی ہے۔ پروسیسنگ فراہم کنندہ نتیجہ ' +
  'بنتے ہی اسے حذف کر دیتا ہے اور اسے تربیت کے لیے استعمال نہیں کرتا۔ اسٹوڈیو کا عملہ آپ کی تصویر نہیں ' +
  'دیکھ سکتا، اور کوئی ٹرائی آن صرف اسی صورت دیکھتا ہے جب آپ اسے استفسار کے ساتھ بھیجیں۔ آپ اپنی تصویر ' +
  'اور نتائج کسی بھی وقت، کسی بھی اسکرین سے حذف کر سکتی ہیں۔';

function buildBodyEn(photoDays: number): string {
  return [
    '## How your photo is used',
    '',
    'Drape is a shortlisting tool. A try-on shows how a garment might sit, so you can narrow a long',
    'catalogue down to a few pieces worth seeing in person. Fabric fall, embroidery detail and length',
    'will differ from what you see on screen.',
    '',
    '### 1. Your photo is used for one thing',
    '',
    'The photo you upload is used only to generate try-on images for you. It is not used for',
    'advertising, it is not shown to other people, and it is not shared with anyone outside the',
    'generation step described below.',
    '',
    '### 2. The processing provider does not keep it',
    '',
    'Generating a try-on sends your photo and the garment image to our processing provider. The',
    'provider deletes the uploaded photo immediately after the result is generated and does not use it',
    'to train any model.',
    '',
    '### 3. How long we keep things',
    '',
    `- **Your photos** are kept for ${photoDays} days after you last use your account, then deleted`,
    '  automatically.',
    '- **Your try-on results** stay in your history for as long as your account exists, so you can come',
    '  back to them without generating again. They carry no expiry date.',
    '- Deleting your account deletes both, along with the underlying image files.',
    '',
    '### 4. What studio staff can see',
    '',
    'Studio staff cannot open your photo. There is no screen, export or report in the admin side of',
    'Drape that shows it. Staff see a try-on result only when you attach it to an enquiry you send',
    'them — that is the only path from your renders to their screen.',
    '',
    'If a photo is flagged for review, a reviewer sees a blurred thumbnail only, and every such view is',
    'recorded.',
    '',
    '### 5. Deleting your photo and results',
    '',
    'A **Delete my photo and results** control is available from every screen once you have uploaded a',
    'photo. Deletion is permanent: the image files are removed, not hidden, and we record that the',
    'deletion happened so it can be verified.',
    '',
    '### Contact',
    '',
    'To ask a question about this policy or request a copy of your data, use the contact address shown',
    'in the app.',
  ].join('\n');
}

function buildBodyUr(photoDays: number): string {
  return [
    '## آپ کی تصویر کیسے استعمال ہوتی ہے',
    '',
    'ڈریپ ایک شارٹ لسٹنگ ٹُول ہے۔ ٹرائی آن یہ دکھاتا ہے کہ لباس کیسا لگ سکتا ہے، تاکہ آپ ایک لمبی',
    'فہرست میں سے چند جوڑے چُن سکیں جنہیں بالمشافہ دیکھنا مناسب ہو۔ کپڑے کا گرنا، کڑھائی کی تفصیل اور',
    'لمبائی اسکرین پر نظر آنے والی چیز سے مختلف ہوں گی۔',
    '',
    '### ۱۔ آپ کی تصویر صرف ایک کام کے لیے',
    '',
    'آپ کی اپ لوڈ کردہ تصویر صرف آپ کے لیے ٹرائی آن نتائج بنانے کے لیے استعمال ہوتی ہے۔ یہ تشہیر کے لیے',
    'استعمال نہیں ہوتی، کسی اور کو نہیں دکھائی جاتی، اور نیچے بیان کردہ جنریشن مرحلے کے علاوہ کسی کے ساتھ',
    'شیئر نہیں کی جاتی۔',
    '',
    '### ۲۔ پروسیسنگ فراہم کنندہ اسے محفوظ نہیں رکھتا',
    '',
    'ٹرائی آن بنانے کے لیے آپ کی تصویر اور لباس کی تصویر ہمارے پروسیسنگ فراہم کنندہ کو بھیجی جاتی ہے۔',
    'فراہم کنندہ نتیجہ بننے کے فوراً بعد اپ لوڈ کردہ تصویر حذف کر دیتا ہے اور اسے کسی ماڈل کی تربیت کے',
    'لیے استعمال نہیں کرتا۔',
    '',
    '### ۳۔ ہم چیزیں کتنی دیر رکھتے ہیں',
    '',
    `- **آپ کی تصاویر** آپ کے اکاؤنٹ کے آخری استعمال کے بعد ${photoDays} دن تک رکھی جاتی ہیں، پھر خودکار`,
    '  طور پر حذف ہو جاتی ہیں۔',
    '- **آپ کے ٹرائی آن نتائج** جب تک آپ کا اکاؤنٹ موجود ہے آپ کی ہسٹری میں رہتے ہیں، تاکہ آپ دوبارہ',
    '  بنائے بغیر انہیں دیکھ سکیں۔ ان کی کوئی میعاد ختم ہونے کی تاریخ نہیں۔',
    '- اکاؤنٹ حذف کرنے پر دونوں چیزیں اور ان کی اصل امیج فائلیں بھی حذف ہو جاتی ہیں۔',
    '',
    '### ۴۔ اسٹوڈیو کا عملہ کیا دیکھ سکتا ہے',
    '',
    'اسٹوڈیو کا عملہ آپ کی تصویر نہیں کھول سکتا۔ ڈریپ کے ایڈمن حصے میں کوئی ایسی اسکرین، ایکسپورٹ یا',
    'رپورٹ نہیں جو اسے دکھائے۔ عملہ کوئی ٹرائی آن نتیجہ صرف اُسی وقت دیکھتا ہے جب آپ اسے اپنے استفسار',
    'کے ساتھ منسلک کر کے بھیجیں — یہی واحد راستہ ہے۔',
    '',
    'اگر کوئی تصویر جائزے کے لیے نشان زد ہو جائے تو جائزہ لینے والا صرف دھندلا تھمب نیل دیکھتا ہے، اور',
    'ہر ایسا مشاہدہ ریکارڈ کیا جاتا ہے۔',
    '',
    '### ۵۔ اپنی تصویر اور نتائج حذف کرنا',
    '',
    'تصویر اپ لوڈ کرنے کے بعد **میری تصویر اور نتائج حذف کریں** کا اختیار ہر اسکرین پر دستیاب رہتا ہے۔',
    'حذف کرنا مستقل ہے: امیج فائلیں چھپائی نہیں جاتیں بلکہ ہٹا دی جاتی ہیں، اور ہم اس حذف کا ریکارڈ رکھتے',
    'ہیں تاکہ اس کی تصدیق ہو سکے۔',
    '',
    '### رابطہ',
    '',
    'اس پالیسی کے بارے میں سوال یا اپنے ڈیٹا کی نقل کی درخواست کے لیے ایپ میں دیے گئے رابطہ پتے پر لکھیں۔',
  ].join('\n');
}
