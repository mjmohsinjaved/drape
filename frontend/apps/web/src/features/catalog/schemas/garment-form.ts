/**
 * The A-8 garment form: its shape, its rules, and the two translations between the form and the
 * wire.
 *
 * A-8 lists eleven fields. Only one of them carries a rule that a single field cannot express:
 *
 * > "…price, rental or sale, **deposit if rental**…"
 *
 * `§4.13` makes it exact — `deposit` is required while `mode = RENTAL` and must be `null` on a
 * sale — and `GarmentsService` re-checks the *merged* record on every write, so a PATCH that
 * flips `mode` alone is still caught. The form's job is to make that rule visible: the deposit
 * field exists only for a rental, and switching to a sale says the deposit will be cleared. The
 * API refusing an invalid combination afterwards is the backstop, not the interface.
 */

import {
  EMBELLISHMENT_WEIGHTS,
  GARMENT_MODES,
  type EmbellishmentWeight,
  type GarmentMode,
  type Uuid,
} from '@repo/api-client';

import type {
  AdminGarment,
  CreateGarmentBody,
  UpdateGarmentBody,
} from '@/features/catalog/types/admin-catalog';

export interface GarmentFormValues {
  sku: string;
  title: string;
  titleUr: string;
  slug: string;
  categoryId: Uuid | '';
  colors: string[];
  fabric: string;
  embellishmentWeight: EmbellishmentWeight;
  /** Kept as a string so a half-typed number never becomes `NaN` mid-keystroke. */
  price: string;
  currency: string;
  mode: GarmentMode;
  deposit: string;
  description: string;
  descriptionUr: string;
  sizes: string[];
  styleTags: string[];
}

export type GarmentFormErrors = Partial<Record<keyof GarmentFormValues, string>>;

/** §4.13 — PKR unless a studio says otherwise. */
export const DEFAULT_GARMENT_CURRENCY = 'PKR';

/** `CreateGarmentDto` field limits, mirrored so the form can enforce them before the round trip. */
export const GARMENT_LIMITS = {
  sku: 64,
  title: 160,
  fabric: 80,
  description: 4000,
  colors: 12,
  sizes: 20,
  styleTags: 20,
  /** `decimal(18,2)`. */
  price: 9_999_999_999.99,
} as const;

export const EMBELLISHMENT_WEIGHT_OPTIONS = EMBELLISHMENT_WEIGHTS;
export const GARMENT_MODE_OPTIONS = GARMENT_MODES;

export function emptyGarmentForm(categoryId: Uuid | '' = ''): GarmentFormValues {
  return {
    sku: '',
    title: '',
    titleUr: '',
    slug: '',
    categoryId,
    colors: [],
    fabric: '',
    embellishmentWeight: 'MEDIUM',
    price: '',
    currency: DEFAULT_GARMENT_CURRENCY,
    mode: 'SALE',
    deposit: '',
    description: '',
    descriptionUr: '',
    sizes: [],
    styleTags: [],
  };
}

export function garmentToForm(garment: AdminGarment): GarmentFormValues {
  return {
    sku: garment.sku,
    title: garment.title,
    titleUr: garment.titleUr ?? '',
    slug: garment.slug,
    categoryId: garment.categoryId,
    colors: garment.colors,
    fabric: garment.fabric ?? '',
    embellishmentWeight: garment.embellishmentWeight,
    price: String(garment.price),
    currency: garment.currency,
    mode: garment.mode,
    deposit: garment.deposit === null ? '' : String(garment.deposit),
    description: garment.description ?? '',
    descriptionUr: garment.descriptionUr ?? '',
    sizes: garment.sizes,
    styleTags: garment.styleTags,
  };
}

function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface ValidationMessages {
  skuRequired: string;
  titleRequired: string;
  categoryRequired: string;
  priceRequired: string;
  priceInvalid: string;
  depositRequired: string;
  depositInvalid: string;
}

/** Everything the API will reject, checked here first so the admin never loses a form to a 422. */
export function validateGarmentForm(
  values: GarmentFormValues,
  messages: ValidationMessages,
): GarmentFormErrors {
  const errors: GarmentFormErrors = {};

  if (values.sku.trim() === '') errors.sku = messages.skuRequired;
  if (values.title.trim() === '') errors.title = messages.titleRequired;
  if (values.categoryId === '') errors.categoryId = messages.categoryRequired;

  const price = parseAmount(values.price);
  if (price === null) errors.price = messages.priceRequired;
  else if (price < 0 || price > GARMENT_LIMITS.price) errors.price = messages.priceInvalid;

  if (values.mode === 'RENTAL') {
    const deposit = parseAmount(values.deposit);
    if (deposit === null) errors.deposit = messages.depositRequired;
    else if (deposit < 0 || deposit > GARMENT_LIMITS.price)
      errors.deposit = messages.depositInvalid;
  }

  return errors;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function formToCreateBody(values: GarmentFormValues): CreateGarmentBody {
  const price = parseAmount(values.price) ?? 0;

  return {
    sku: values.sku.trim(),
    title: values.title.trim(),
    ...(optional(values.titleUr) === undefined ? {} : { titleUr: values.titleUr.trim() }),
    ...(optional(values.slug) === undefined ? {} : { slug: values.slug.trim() }),
    categoryId: values.categoryId as Uuid,
    colors: values.colors,
    ...(optional(values.fabric) === undefined ? {} : { fabric: values.fabric.trim() }),
    embellishmentWeight: values.embellishmentWeight,
    price,
    currency: values.currency,
    mode: values.mode,
    // A sale never carries a deposit: the DTO refuses one outright (§4.13).
    ...(values.mode === 'RENTAL' ? { deposit: parseAmount(values.deposit) ?? 0 } : {}),
    ...(optional(values.description) === undefined
      ? {}
      : { description: values.description.trim() }),
    ...(optional(values.descriptionUr) === undefined
      ? {}
      : { descriptionUr: values.descriptionUr.trim() }),
    sizes: values.sizes,
    styleTags: values.styleTags,
  };
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A PATCH sends everything the form owns, with `null` for a cleared field.
 *
 * Sending the whole form rather than a diff is deliberate: the API validates the *merged* record,
 * so a diff that omits `deposit` while changing `mode` would be checked against a stale deposit.
 */
export function formToUpdateBody(values: GarmentFormValues): UpdateGarmentBody {
  return {
    sku: values.sku.trim(),
    title: values.title.trim(),
    titleUr: nullable(values.titleUr),
    slug: values.slug.trim() === '' ? undefined : values.slug.trim(),
    categoryId: values.categoryId === '' ? undefined : values.categoryId,
    colors: values.colors,
    fabric: nullable(values.fabric),
    embellishmentWeight: values.embellishmentWeight,
    price: parseAmount(values.price) ?? 0,
    currency: values.currency,
    mode: values.mode,
    deposit: values.mode === 'RENTAL' ? (parseAmount(values.deposit) ?? 0) : null,
    description: nullable(values.description),
    descriptionUr: nullable(values.descriptionUr),
    sizes: values.sizes,
    styleTags: values.styleTags,
  };
}
