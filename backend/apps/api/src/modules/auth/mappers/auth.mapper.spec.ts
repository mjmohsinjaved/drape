import { Locale, Role, UserStatus } from '@library/common';

import { buildSession } from '../../../../test/factories';
import { FIXED_NOW } from '../../../../test/setup/time';
import { buildAuthUser } from '../testing/auth-fixtures';

import {
  toAuthUserDto,
  toNotificationLocale,
  toSessionSummaryDto,
  truncateIp,
} from './auth.mapper';

/**
 * ARCHITECTURE §2.9 — "controllers NEVER return raw entities".
 *
 * The mapper is where that promise is kept, so these tests are mostly about what is
 * *absent*: the password hash, the 2FA secret, the recovery-code hashes, the session
 * token hash and the CSRF secret.
 */
describe('toAuthUserDto', () => {
  const user = buildAuthUser({
    passwordHash: '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA$aGFzaA',
    phone: '+923001234567',
  });

  it('carries the fields GET /auth/me promises (B-10)', () => {
    const dto = toAuthUserDto(user);

    expect(dto).toMatchObject({
      id: user.id,
      role: Role.CONSUMER,
      email: user.email,
      name: user.name,
      status: UserStatus.ACTIVE,
      locale: Locale.EN,
    });
  });

  it('carries no secret of any kind', () => {
    const serialised = JSON.stringify(toAuthUserDto(user));

    expect(serialised).not.toContain('argon2');
    expect(toAuthUserDto(user)).not.toHaveProperty('passwordHash');
  });

  it('masks the phone number even for its owner (E-12)', () => {
    const dto = toAuthUserDto(user);

    expect(dto.phone).not.toBe('+923001234567');
    expect(dto.phone).toContain('*');
    // Enough tail to recognise the number, not enough to be the number.
    expect(dto.phone?.endsWith('67')).toBe(true);
    expect(dto.phone).not.toContain('92300');
  });

  it('renders timestamps as ISO-8601 and nulls as null', () => {
    const dto = toAuthUserDto(buildAuthUser({ emailVerifiedAt: FIXED_NOW, phoneVerifiedAt: null }));

    expect(dto.emailVerifiedAt).toBe(FIXED_NOW.toISOString());
    expect(dto.phoneVerifiedAt).toBeNull();
    expect(toAuthUserDto(buildAuthUser({ phone: null })).phone).toBeNull();
  });
});

describe('toSessionSummaryDto', () => {
  const session = buildSession({ ip: '203.0.113.44', userAgent: 'Firefox' });

  it('marks the caller’s own session', () => {
    expect(toSessionSummaryDto(session, session.id).current).toBe(true);
    expect(toSessionSummaryDto(session, 'another-session').current).toBe(false);
  });

  it('never exposes the token hash or the CSRF secret', () => {
    const serialised = JSON.stringify(toSessionSummaryDto(session, session.id));

    expect(serialised).not.toContain(session.tokenHash);
    expect(serialised).not.toContain(session.csrfSecret);
  });

  it('truncates the address', () => {
    expect(toSessionSummaryDto(session, session.id).ip).toBe('203.0.113.x');
  });
});

describe('truncateIp', () => {
  it.each([
    ['203.0.113.44', '203.0.113.x'],
    ['127.0.0.1', '127.0.0.x'],
    ['2001:db8::1', '2001:db8:x'],
    ['::1', '1:x'],
  ])('truncates %s to %s', (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });

  it.each([
    ['', 'unknown'],
    ['nonsense', 'unknown'],
  ])('reports %p as unknown rather than passing it through', (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });
});

describe('toNotificationLocale', () => {
  it.each([
    [Locale.EN, 'EN'],
    [Locale.UR, 'UR'],
  ])('maps %s to %s', (locale, expected) => {
    expect(toNotificationLocale(locale)).toBe(expected);
  });
});
