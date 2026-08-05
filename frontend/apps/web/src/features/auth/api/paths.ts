/**
 * Every API path the auth feature touches — ARCHITECTURE §5.1 (`auth`) and §5.3 (`invites`).
 *
 * §6.4 asks for one typed function per §5 route in `packages/api-client/src/endpoints/`. That
 * directory does not exist in the package yet, and `packages/**` is the reviewed contract, so
 * the feature keeps its own path table and reaches the network only through the hooks and the
 * server helper — both of which go through `@repo/api-client`. **No component in this feature
 * calls `apiClient`, `fetch` or axios directly.**
 *
 * Paths are relative to `NEXT_PUBLIC_API_BASE_URL`, which already carries `/api/v1`.
 */
export const authApi = {
  /** `GET /auth/me` (ANY) — the single role-resolution call (B-10). */
  me: '/auth/me',
  /** `POST /auth/signup` (PUBLIC, ⊘ CSRF) — always a Consumer account (S-4). */
  signup: '/auth/signup',
  /** `POST /auth/login` (PUBLIC, ⊘ CSRF) — generic failure copy (S-6). */
  login: '/auth/login',
  /** `POST /auth/logout` (ANY). */
  logout: '/auth/logout',

  /** `POST /auth/2fa/challenge` (PUBLIC) — completes a `twofaPending` session (S-8). */
  twoFactorChallenge: '/auth/2fa/challenge',
  /** `POST /auth/2fa/recovery` (PUBLIC) — the single-use code path out of a lost device. */
  twoFactorRecovery: '/auth/2fa/recovery',
  /** `POST /auth/2fa/setup` (ANY) — returns the secret and the `otpauth://` provisioning URI. */
  twoFactorSetup: '/auth/2fa/setup',
  /** `POST /auth/2fa/enable` (ANY) — confirms a code and returns the recovery codes once. */
  twoFactorEnable: '/auth/2fa/enable',
  /** `POST /auth/2fa/disable` (ANY) — refused for admins (S-8). */
  twoFactorDisable: '/auth/2fa/disable',

  /** `POST /auth/password/forgot` (PUBLIC) — always 200, always the same body (S-6). */
  passwordForgot: '/auth/password/forgot',
  /** `POST /auth/password/reset` (PUBLIC) — single-use 30-minute token (S-6). */
  passwordReset: '/auth/password/reset',
  /** `POST /auth/password/change` (ANY) — revokes every other session (C-7). */
  passwordChange: '/auth/password/change',

  /** `POST /auth/email/verify/request` (ANY) — re-sends the verification email (C-3). */
  emailVerifyRequest: '/auth/email/verify/request',
  /** `POST /auth/email/verify/confirm` (PUBLIC) — consumes the emailed token (C-3). */
  emailVerifyConfirm: '/auth/email/verify/confirm',

  /** `POST /auth/phone/otp/request` (CONSUMER) — C-3. */
  phoneOtpRequest: '/auth/phone/otp/request',
  /** `POST /auth/phone/otp/verify` (CONSUMER) — stamps `phoneVerifiedAt` (C-3). */
  phoneOtpVerify: '/auth/phone/otp/verify',

  /** `GET /auth/sessions` (ANY) — the caller's own live sessions. */
  sessions: '/auth/sessions',
  /** `DELETE /auth/sessions/:sessionId` (ANY). */
  session: (sessionId: string): string => `/auth/sessions/${sessionId}`,

  /** `GET /invites/token/:token` (PUBLIC) — validates a token for the acceptance form (S-5). */
  invitePreview: (token: string): string => `/invites/token/${encodeURIComponent(token)}`,
  /** `POST /invites/token/:token/accept` (PUBLIC) — creates the admin account (S-5). */
  inviteAccept: (token: string): string => `/invites/token/${encodeURIComponent(token)}/accept`,
} as const;
