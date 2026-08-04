/**
 * Identity enums — ARCHITECTURE.md §4.1 enum registry and §2.6.
 *
 * `Role` is the authorisation contract read by `@Roles()` and `RolesGuard`.
 * `UserStatus` and `Locale` live here too because `ICurrentUser` (§2.6) is declared
 * in this library and needs them, while §1.1 gives `libs/common/src/constants/` only
 * three files. They are identity-shaped, so they sit beside `Role` rather than
 * spawning a fourth constants file outside the specified tree.
 */

/**
 * `role_enum` in PostgreSQL, values `ADMIN` and `CONSUMER`.
 *
 * `PUBLIC` is a **TypeScript-only** member used by `@Roles(Role.PUBLIC)` to declare
 * that a route is open. It is never stored, never returned by a session lookup and
 * never assigned to a user.
 */
export enum Role {
  ADMIN = 'ADMIN',
  CONSUMER = 'CONSUMER',
  /** TS-only. Declares an open route (§2.6). Never persisted. */
  PUBLIC = 'PUBLIC',
}

/** The roles a `users` row can actually hold — `role_enum` in PostgreSQL. */
export const USER_ROLES = [Role.ADMIN, Role.CONSUMER] as const;

/** A persisted role. Excludes the TS-only `Role.PUBLIC`. */
export type UserRole = (typeof USER_ROLES)[number];

/** `user_status_enum` (§4.1). */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

/** `locale_enum` (§4.1). */
export enum Locale {
  EN = 'EN',
  UR = 'UR',
}

/**
 * Role hierarchy. Higher rank strictly includes every capability of a lower rank,
 * so `hasRoleAtLeast(Role.ADMIN, Role.CONSUMER)` is true.
 *
 * The hierarchy is a convenience for service-layer checks. **`RolesGuard` does not
 * use it** — route authorisation is exact membership in the `@Roles()` list, so a
 * handler that lists only `CONSUMER` is not silently reachable by an admin (§2.7).
 */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  [Role.PUBLIC]: 0,
  [Role.CONSUMER]: 1,
  [Role.ADMIN]: 2,
};

/** true when `value` is a member of the `Role` enum. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

/** true when `value` is a role a `users` row can hold (i.e. not `Role.PUBLIC`). */
export function isUserRole(value: unknown): value is UserRole {
  return value === Role.ADMIN || value === Role.CONSUMER;
}

/** true when `role` ranks at or above `minimum` in the hierarchy. */
export function hasRoleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** true when `role` is `ADMIN`. */
export function isAdmin(role: Role | undefined | null): boolean {
  return role === Role.ADMIN;
}

/** true when `role` is `CONSUMER`. */
export function isConsumer(role: Role | undefined | null): boolean {
  return role === Role.CONSUMER;
}

/**
 * Exact-membership check used by `RolesGuard`.
 *
 * `Role.PUBLIC` anywhere in `allowed` opens the route to everyone, signed in or not.
 * Otherwise the caller must hold a role that appears in the list — no hierarchy
 * widening, fail closed on an absent role.
 */
export function satisfiesRoles(role: Role | undefined | null, allowed: readonly Role[]): boolean {
  if (allowed.includes(Role.PUBLIC)) {
    return true;
  }
  if (role === undefined || role === null) {
    return false;
  }
  return allowed.includes(role);
}
