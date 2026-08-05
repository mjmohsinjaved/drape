import { ErrorCode, ValidationException } from '@library/common';

import {
  DEFAULT_ANALYTICS_WINDOW_DAYS,
  MAX_ANALYTICS_WINDOW_DAYS,
} from '../constants/analytics.constants';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A resolved, bounded reporting window. Every analytics query takes one. */
export interface AnalyticsWindow {
  readonly from: Date;
  readonly to: Date;
  readonly days: number;
}

/** What a caller may ask for. Both ends optional; the resolver fills the gaps. */
export interface AnalyticsWindowRequest {
  readonly from?: string;
  readonly to?: string;
  readonly days?: number;
}

/**
 * Turns a caller's request into a window that is guaranteed to be **bounded**.
 *
 * ### Why this is a function and not four lines in each service
 *
 * §5.18 requires every analytics query to be bounded and indexed-friendly. A window is
 * how "bounded" is expressed in SQL, so every query in this module takes one — and if
 * each service resolved its own, one of them would eventually accept an open-ended
 * `from` and turn a dashboard tile into a full table scan the first time the platform
 * had a year of data. There is one resolver, it refuses anything wider than
 * {@link MAX_ANALYTICS_WINDOW_DAYS}, and it refuses loudly rather than clamping.
 *
 * Clamping would be worse than refusing: an admin who asks for two years and is quietly
 * given one is reading a chart that does not say what she thinks it says.
 */
export function resolveAnalyticsWindow(
  request: AnalyticsWindowRequest,
  now: Date = new Date(),
): AnalyticsWindow {
  const to = request.to === undefined ? now : parseBoundary(request.to, 'to');
  const from =
    request.from === undefined
      ? new Date(
          to.getTime() - (request.days ?? DEFAULT_ANALYTICS_WINDOW_DAYS) * MILLISECONDS_PER_DAY,
        )
      : parseBoundary(request.from, 'from');

  if (from.getTime() > to.getTime()) {
    throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
      message: 'The start of the window is after its end.',
      errors: [{ field: 'from', message: 'from must be before to', code: 'WINDOW_INVERTED' }],
    });
  }

  const days = (to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY;
  if (days > MAX_ANALYTICS_WINDOW_DAYS) {
    throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
      message: `Reporting windows are limited to ${MAX_ANALYTICS_WINDOW_DAYS} days.`,
      errors: [
        {
          field: 'from',
          message: `window must be ${MAX_ANALYTICS_WINDOW_DAYS} days or fewer`,
          code: 'WINDOW_TOO_WIDE',
        },
      ],
      details: { maxDays: MAX_ANALYTICS_WINDOW_DAYS, requestedDays: Math.round(days) },
    });
  }

  return { from, to, days: Math.max(1, Math.round(days)) };
}

function parseBoundary(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationException(ErrorCode.VALIDATION_ERROR, {
      message: 'That is not a date this report can start or end at.',
      errors: [{ field, message: `${field} must be an ISO-8601 date-time`, code: 'IS_ISO8601' }],
    });
  }
  return parsed;
}
