// libs/database/src/transformers/decimal.transformer.ts
import type { ValueTransformer } from 'typeorm';

/**
 * ARCHITECTURE.md §2.1 — money.
 *
 * `decimal(18,2)` comes back from `pg` as a string, because JS numbers cannot represent
 * every value the column can hold. Always transform, so TypeScript sees `number` and no
 * call site ever does arithmetic on a string.
 *
 * Exactness: `decimal(18,2)` stores at most 16 integral digits. A JS number is exact up to
 * 2^53 - 1, i.e. 90,071,993,547,758.07 in minor units — comfortably above any PKR amount
 * this product handles. Beyond that the transformer would lose precision, so no column may
 * use it for anything but money.
 *
 * Never widen this to `float`/`real`/`double precision`. Never store a formatted string.
 * Currency lives in a separate `char(3)` column defaulting to `'PKR'`.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};

/**
 * Variant for `nullable: true` monetary columns where the database, or a partially
 * populated DTO, can hand back something that is not a finite number.
 *
 * Differences from {@link decimalTransformer}:
 * - `undefined`, `''` and whitespace read back as `null` rather than `NaN`.
 * - a non-finite input on the way *in* becomes `null` rather than being handed to `pg`,
 *   which would reject `NaN`/`Infinity` on a `numeric` column at write time.
 *
 * Behaviour is otherwise identical, so a column can be moved between the two without a
 * data migration.
 */
export const nullableDecimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null,
  from: (value: string | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

/** Precision and scale every monetary column declares. Do not vary these per table. */
export const DECIMAL_PRECISION = 18;

/** Scale every monetary column declares — two minor units. */
export const DECIMAL_SCALE = 2;
