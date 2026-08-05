import { Locale, maskPhone } from '@library/common';
import type { NotificationLocale } from '@library/notifications';

import { type AuthUserDto, type SessionSummaryDto } from '../dto/auth-response.dto';

import type { Session } from '../entities/session.entity';
import type { AuthUser } from '../interfaces/user-directory.interface';

/**
 * `Locale` (a string enum, nominal in TypeScript) → `NotificationLocale` (a string
 * union). The values are identical; the conversion exists because the two types are
 * not assignable to one another, and one exhaustive mapping is better than a cast at
 * every send site.
 */
export function toNotificationLocale(locale: Locale): NotificationLocale {
  return locale === Locale.UR ? 'UR' : 'EN';
}

/**
 * Entity → response DTO — ARCHITECTURE §2.9.
 *
 * The only place the auth response shape is decided, and the only reason a
 * controller never returns a raw entity: `users` carries a password hash, a 2FA
 * secret and recovery-code hashes, and `sessions` carries the CSRF secret and the
 * token hash. None of them has any business leaving the process.
 */
export function toAuthUserDto(user: AuthUser): AuthUserDto {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    status: user.status,
    emailVerifiedAt: toIso(user.emailVerifiedAt),
    phoneVerifiedAt: toIso(user.phoneVerifiedAt),
    // Masked even for the owner: this response is rendered in a browser and copied
    // into support tickets, and the last four digits are enough to recognise it.
    phone: user.phone === null ? null : maskPhone(user.phone),
    locale: user.locale,
    twofaEnabled: user.twofaEnabledAt !== null,
  };
}

/**
 * One row of `GET /auth/sessions`.
 *
 * `tokenHash` and `csrfSecret` are absent by construction, and the address is
 * truncated — enough for the owner to recognise a device, not enough to become a
 * location record in a screenshot (E-12).
 */
export function toSessionSummaryDto(session: Session, currentSessionId: string): SessionSummaryDto {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    userAgent: session.userAgent,
    ip: truncateIp(session.ip),
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

/**
 * Drops the host portion of an address: `203.0.113.44` → `203.0.113.x`,
 * `2001:db8::1` → `2001:db8:x`.
 */
export function truncateIp(ip: string): string {
  if (typeof ip !== 'string' || ip.length === 0) {
    return 'unknown';
  }
  if (ip.includes(':')) {
    const groups = ip.split(':').filter((group) => group.length > 0);
    return `${groups.slice(0, 2).join(':')}:x`;
  }
  const octets = ip.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.x` : 'unknown';
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
