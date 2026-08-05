import { FUNNEL_STEPS, type FunnelStep } from '@library/common';

/**
 * The six counts A-36 asks for, in order.
 *
 * Each is a **cohort** count: consumers who signed up inside the window and reached
 * that step, whenever they reached it. Counting "photos uploaded in the window" instead
 * would mix a consumer who signed up in March into February's conversion rate, and the
 * funnel would stop being a funnel.
 */
export interface FunnelCounts {
  readonly SIGNUP: number;
  readonly EMAIL_VERIFIED: number;
  readonly PHOTO_UPLOADED: number;
  readonly FIRST_TRYON: number;
  readonly SHORTLISTED: number;
  readonly ENQUIRY: number;
}

/** One step of the rendered funnel. */
export interface FunnelStepResult {
  readonly step: FunnelStep;
  readonly count: number;
  /** Percent of the signup cohort that reached this step, one decimal. */
  readonly conversionFromStart: number;
  /** Percent of the *previous* step that reached this one. 100 for the first step. */
  readonly conversionFromPrevious: number;
  /** How many were lost between the previous step and this one. Never negative. */
  readonly droppedFromPrevious: number;
}

/**
 * **A-36 — signups → email verified → photo uploaded → first try-on → ≥1 star → enquiry.**
 *
 * Pure arithmetic over six numbers, kept out of the service so it can be exercised from
 * a literal (E-5) and so the two conversion rates are computed in exactly one place.
 *
 * ### The two rates are different questions, and both are asked
 *
 * `conversionFromStart` answers "what fraction of everyone who signed up got here?" —
 * the shape of the whole funnel. `conversionFromPrevious` answers "what fraction of the
 * people who got to the last step got to this one?" — where the leak is. A funnel that
 * reports only the first number hides a catastrophic single step behind a gently
 * sloping curve.
 *
 * ### Division by zero is a real case, not a defensive one
 *
 * A window with no signups is the normal state of a staging environment and the first
 * week of a new deployment. Zero signups gives every step a rate of zero rather than
 * `NaN`, because `NaN` reaches the browser as `null` through JSON and renders as a
 * blank tile that looks like a bug.
 *
 * ### Monotonicity is not assumed
 *
 * The counts come from six independent aggregate queries, and nothing in the schema
 * forbids a consumer starring a garment without a `person_photos` row — a shared render
 * she voted on, a photograph she has since deleted (C-38, C-28: the render survives).
 * So `droppedFromPrevious` floors at zero instead of going negative, and a step larger
 * than the one before it is reported as it is rather than being smoothed away.
 */
export function buildFunnel(counts: FunnelCounts): FunnelStepResult[] {
  const start = counts.SIGNUP;

  return FUNNEL_STEPS.map((step, index) => {
    const count = counts[step];
    const previous = index === 0 ? count : counts[FUNNEL_STEPS[index - 1]];

    return {
      step,
      count,
      conversionFromStart: percent(count, start),
      conversionFromPrevious: index === 0 ? 100 : percent(count, previous),
      droppedFromPrevious: index === 0 ? 0 : Math.max(0, previous - count),
    };
  });
}

/**
 * `numerator / denominator` as a percentage, one decimal place.
 *
 * A zero denominator yields zero. See the note above on why that is the honest answer
 * rather than `NaN` or `null`.
 */
export function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}
