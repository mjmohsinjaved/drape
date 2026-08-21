export enum Role {
  ADMIN = 'ADMIN',
  CONSUMER = 'CONSUMER',
  PUBLIC = 'PUBLIC',
}

export const USER_ROLES = [Role.ADMIN, Role.CONSUMER] as const;

export type UserRole = (typeof USER_ROLES)[number];

export enum UserStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DEACTIVATED = 'DEACTIVATED',
}

export enum Locale {
  EN = 'EN',
  UR = 'UR',
}

export const ROLE_RANK: Readonly<Record<Role, number>> = {
  [Role.PUBLIC]: 0,
  [Role.CONSUMER]: 1,
  [Role.ADMIN]: 2,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

export function isUserRole(value: unknown): value is UserRole {
  return value === Role.ADMIN || value === Role.CONSUMER;
}

export function hasRoleAtLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function isAdmin(role: Role | undefined | null): boolean {
  return role === Role.ADMIN;
}

export function isConsumer(role: Role | undefined | null): boolean {
  return role === Role.CONSUMER;
}

export function satisfiesRoles(role: Role | undefined | null, allowed: readonly Role[]): boolean {
  if (allowed.includes(Role.PUBLIC)) {
    return true;
  }
  if (role === undefined || role === null) {
    return false;
  }
  return allowed.includes(role);
}
