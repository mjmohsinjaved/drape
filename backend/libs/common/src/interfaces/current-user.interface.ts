import type { Locale, Role, UserStatus } from '../constants/roles.constant';

/**
 * The authenticated caller — ARCHITECTURE.md §2.6.
 *
 * `request.user` is populated **only** by `SessionAuthGuard`, from the `sessions`
 * row joined to `users`. It is never read from a header, query parameter, body
 * field or any other client-supplied claim (S-3).
 */
export interface ICurrentUser {
  id: string;
  /** Resolved server-side from the session row (S-3). Never `Role.PUBLIC`. */
  role: Role;
  email: string;
  name: string;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  sessionId: string;
  locale: Locale;
}

/**
 * The shape the guard chain writes onto the Express request.
 *
 * Declared as an interface rather than a module augmentation so that libraries
 * stay free of global side effects; guards and decorators narrow to this locally.
 */
export interface RequestWithUser {
  user?: ICurrentUser;
}
