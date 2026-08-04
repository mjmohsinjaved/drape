/**
 * App-level constants. Design tokens are **not** here — they live in `@repo/ui` and reach the
 * app only as Tailwind utilities (§6.1). Nothing in this file is a colour, a spacing value or
 * a font stack.
 */

/** The product name, used in titles, Open Graph and the skip link. */
export const APP_NAME = 'Drape';

/**
 * Roles as the API defines them (§4.1 `role_enum`). Used to pick a shell, never to authorise:
 * role resolution in the web app is presentation only (S-3, B-10).
 */
export const Role = {
  ADMIN: 'ADMIN',
  CONSUMER: 'CONSUMER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Error codes this shell reacts to structurally. The full set lives in `@repo/api-client`. */
export const ErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID: 'SESSION_INVALID',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Query-string key carrying the path a user was heading to when the session ran out. */
export const RETURN_TO_PARAM = 'from';

/** Timeouts for the server-side, cookie-forwarding client (§6.4). */
export const SERVER_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Layout constants that are structural rather than decorative. Everything visual comes from
 * the token set; these exist because JS needs the same numbers the CSS uses.
 */
export const layout = {
  /** D-9: every layout holds from here up. */
  minSupportedWidthPx: 360,
  /** D-10: the touch-target floor, in px. */
  minTouchTargetPx: 44,
  /** §6.2: below this the admin tables collapse to stacked cards. */
  adminStackBreakpointPx: 768,
} as const;

// The consumer navigation inventory (C-9) lives in `@/components/layout/nav-items`, so there
// is one list rather than a list and a copy of it.
