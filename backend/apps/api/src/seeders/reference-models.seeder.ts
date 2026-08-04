import sharp from 'sharp';
import { In } from 'typeorm';

import { StorageKeys, StorageService } from '@library/storage';

import { ReferenceModel } from '@api/modules/tryon/entities/reference-model.entity';

import type { SeedContext, SeedOutcome, Seeder } from './seeder.contract';

/**
 * The built-in reference model photos used by the A-11 test-render gate (PRD E-4, §4.15).
 *
 * These are the **only** person images an admin ever sends upstream. A consumer's photo is
 * never used for a test render — that separation is what makes S-10 ("admins can never see
 * a consumer's photo") hold at the generation boundary as well as at the query layer.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 *  ⚠  THESE ARE PLACEHOLDERS. REPLACE THEM WITH REAL REFERENCE PHOTOGRAPHY BEFORE
 *     PRODUCTION.
 *
 *  There is no licensed reference photography in this repository, and committing binary
 *  image assets to source control is not how these should ship. So the seeder *draws* its
 *  own: a flat background with a plain figure outline and framing guides, generated with
 *  `sharp` from an SVG below. They are illustrated diagrams, never a photograph of a real
 *  person — the same rule C-13 applies to the consumer photo-guidance illustrations, for
 *  the same reason.
 *
 *  A silhouette will not produce a usable try-on render upstream. It exists so that a
 *  fresh installation has a complete, referentially-valid A-11 gate to develop and test
 *  against, and so the mock TryOn driver has something real to read. Before the catalog is
 *  populated for real, an admin uploads genuine reference photography and archives these.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

interface ReferenceModelSeed {
  /** Idempotency key for this seeder — `label` is what identifies a built-in model. */
  readonly label: string;
  readonly position: number;
  /** Flat background colour. */
  readonly background: string;
  /** Figure fill. Deliberately a flat, neutral tone — this is a diagram, not a rendering. */
  readonly figure: string;
  /** Framing-guide stroke. */
  readonly guide: string;
  /** Degrees the arms are held away from the torso, so the three placeholders differ. */
  readonly armAngle: number;
}

const REFERENCE_MODEL_SEEDS: readonly ReferenceModelSeed[] = [
  {
    label: 'Placeholder A — front facing, arms down',
    position: 0,
    background: '#F2EDE8',
    figure: '#8E8078',
    guide: '#D9CFC7',
    armAngle: 4,
  },
  {
    label: 'Placeholder B — front facing, arms slightly out',
    position: 1,
    background: '#ECEFF1',
    figure: '#7C858C',
    guide: '#CFD6DB',
    armAngle: 14,
  },
  {
    label: 'Placeholder C — front facing, narrow stance',
    position: 2,
    background: '#F1EFEA',
    figure: '#87857C',
    guide: '#D5D2C9',
    armAngle: 8,
  },
];

/** Portrait, long edge 2100px — comfortably above the 2000px floor A-10 asks of source imagery. */
const IMAGE_WIDTH = 1400;
const IMAGE_HEIGHT = 2100;

/** Grid thumbnail. §3.3 fixes the extension at `.webp`; §3.6 fixes quality at 78. */
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 480;
const THUMBNAIL_QUALITY = 78;

export const referenceModelsSeeder: Seeder = {
  name: 'reference-models',

  async run(context: SeedContext): Promise<SeedOutcome> {
    const repository = context.manager.getRepository(ReferenceModel);
    const storage = context.app.get(StorageService);

    const existing = await repository.find({
      select: { label: true },
      where: { label: In(REFERENCE_MODEL_SEEDS.map((seed) => seed.label)) },
    });
    const existingLabels = new Set(existing.map((row) => row.label));

    const missing = REFERENCE_MODEL_SEEDS.filter((seed) => !existingLabels.has(seed.label));
    if (missing.length === 0) {
      return {
        created: 0,
        skipped: existingLabels.size,
        notes: ['Reference models already present — no placeholder images were written.'],
      };
    }

    // `UQ_reference_models_default` permits exactly one default (§4.15). Only claim it if
    // nothing else holds it — a database that has moved on keeps its own choice.
    let defaultTaken = (await repository.count({ where: { isDefault: true } })) > 0;

    for (const seed of missing) {
      const svg = Buffer.from(buildPlaceholderSvg(seed), 'utf8');

      const full = await sharp(svg).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
      const thumbnail = await sharp(svg)
        .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'cover' })
        .webp({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

      // Keys are built ONLY by the storage key builder (§3.3). Nothing here concatenates a
      // path, and nothing here knows where STORAGE_ROOT is.
      const storageKey = StorageKeys.referenceModel();
      const thumbnailKey = StorageKeys.thumbnail('reference-model');

      const stored = await storage.put(storageKey, full, {
        contentType: 'image/jpeg',
        failIfExists: true,
      });
      await storage.put(thumbnailKey, thumbnail, {
        contentType: 'image/webp',
        failIfExists: true,
      });

      await repository.save(
        repository.create({
          label: seed.label,
          storageKey,
          thumbnailKey,
          // The service returns sha256 of the bytes it wrote; that is the hash column (§3.2 #7).
          hash: stored.sha256,
          isDefault: !defaultTaken,
          position: seed.position,
          active: true,
        }),
      );

      defaultTaken = true;
    }

    return {
      created: missing.length,
      skipped: existingLabels.size,
      notes: [
        'PLACEHOLDER imagery: generated silhouettes, not photographs. They will not produce a',
        'usable upstream render. Replace with real reference photography before production —',
        'upload the real files, then archive these rows (active = false).',
      ],
    };
  },
};

/**
 * A flat-background figure diagram with framing guides.
 *
 * Shapes only — no `<text>`. Text rendering depends on the fonts installed on the host, and
 * a seeder that produces a different image on CI than on a developer's machine is a seeder
 * that produces a different `hash`, which would silently fragment the §3.7 content cache.
 */
function buildPlaceholderSvg(seed: ReferenceModelSeed): string {
  const centreX = IMAGE_WIDTH / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}"`,
    ` viewBox="0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}">`,
    `<rect width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}" fill="${seed.background}"/>`,

    // Framing guides — full-body crop and the vertical centre line, mirroring the C-13
    // photo-guidance diagrams so the two read as one family.
    `<rect x="80" y="80" width="${IMAGE_WIDTH - 160}" height="${IMAGE_HEIGHT - 160}" fill="none"`,
    ` stroke="${seed.guide}" stroke-width="6" stroke-dasharray="28 20"/>`,
    `<line x1="${centreX}" y1="80" x2="${centreX}" y2="${IMAGE_HEIGHT - 80}" stroke="${seed.guide}"`,
    ' stroke-width="4" stroke-dasharray="14 18"/>',

    `<g fill="${seed.figure}">`,
    '<ellipse cx="700" cy="360" rx="112" ry="134"/>',
    '<rect x="668" y="470" width="64" height="92" rx="26"/>',
    '<path d="M 596 548 Q 700 500 804 548 L 846 800 L 792 1130 L 608 1130 L 554 800 Z"/>',
    '<rect x="616" y="1088" width="168" height="146" rx="54"/>',
    `<g transform="rotate(${seed.armAngle} 566 566)">`,
    '<rect x="506" y="552" width="70" height="644" rx="35"/></g>',
    `<g transform="rotate(${-seed.armAngle} 834 566)">`,
    '<rect x="824" y="552" width="70" height="644" rx="35"/></g>',
    '<rect x="610" y="1180" width="88" height="762" rx="44"/>',
    '<rect x="702" y="1180" width="88" height="762" rx="44"/>',
    '<ellipse cx="646" cy="1948" rx="64" ry="30"/>',
    '<ellipse cx="754" cy="1948" rx="64" ry="30"/>',
    '</g>',
    '</svg>',
  ].join('');
}
