/**
 * Doubles for the `files` unit tests.
 *
 * The `SignedUrlService` here is the **real** one, built over a throwaway secret. Tokens are
 * therefore genuinely signed and genuinely verified: a test that says "an expired token is
 * refused" is exercising the HMAC path, not a stub that was told to say no. Only the driver
 * behind `StorageService` is faked, because that is the part that would otherwise need a disk.
 */
import { Locale, Role, UserStatus, type ICurrentUser } from '@library/common';
import { SignedUrlService, type StorageConfig } from '@library/storage';

/** A storage configuration that resolves nothing and touches nothing. */
export const TEST_STORAGE_CONFIG: StorageConfig = {
  driver: 'local',
  root: '/nowhere/drape-storage',
  // 64 characters, and a test-only value: it never leaves this file (E-2 forbids a default in
  // production code, not a literal in a spec).
  urlSecret: 'a'.repeat(64),
  apiBaseUrl: 'https://api.test',
  photoUrlTtlSeconds: 300,
  renderUrlTtlSeconds: 900,
  publicUrlTtlSeconds: 3600,
  uploadTicketTtlSeconds: 900,
  maxUploadBytes: 25 * 1024 * 1024,
  minFreeBytes: 2048 * 1024 * 1024,
};

export function createSignedUrlService(): SignedUrlService {
  return new SignedUrlService(TEST_STORAGE_CONFIG);
}

export const CONSUMER_ID = '11111111-2222-4333-8444-555566667777';
export const OTHER_CONSUMER_ID = '99999999-8888-4777-8666-555544443333';
export const ADMIN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000';
export const GARMENT_ID = '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c';

export function buildCurrentUser(overrides: Partial<ICurrentUser> = {}): ICurrentUser {
  return {
    id: CONSUMER_ID,
    role: Role.CONSUMER,
    email: 'consumer@example.com',
    name: 'Test Consumer',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    phoneVerifiedAt: null,
    sessionId: '12341234-5678-4901-8234-567890123456',
    locale: Locale.EN,
    ...overrides,
  };
}

export const CONSUMER: ICurrentUser = buildCurrentUser();
export const OTHER_CONSUMER: ICurrentUser = buildCurrentUser({
  id: OTHER_CONSUMER_ID,
  email: 'other@example.com',
});
export const ADMIN: ICurrentUser = buildCurrentUser({
  id: ADMIN_ID,
  role: Role.ADMIN,
  email: 'admin@example.com',
  name: 'Studio Admin',
});
