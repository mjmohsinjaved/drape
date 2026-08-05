import { AppException, ErrorCode } from '@library/common';

import { testAuthConfig } from '../testing/auth-fixtures';

import { PasswordService } from './password.service';

/**
 * PRD S-6 — Argon2id password hashing.
 *
 * The three properties worth proving: the stored value is a real Argon2id hash and
 * never the password; verification is total (a corrupt hash is `false`, not a 500);
 * and the absent-account branch does the same cryptographic work as the present one,
 * because that is what makes login's timing uninformative.
 */
describe('PasswordService — hashing', () => {
  const service = new PasswordService(testAuthConfig());
  const password = 'correct-horse-9!';

  it('produces an Argon2id hash that does not contain the password', async () => {
    const hash = await service.hash(password);

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(password);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([service.hash(password), service.hash(password)]);

    expect(first).not.toEqual(second);
    await expect(service.verify(first, password)).resolves.toBe(true);
    await expect(service.verify(second, password)).resolves.toBe(true);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, password)).resolves.toBe(true);
    await expect(service.verify(hash, 'correct-horse-9')).resolves.toBe(false);
    await expect(service.verify(hash, '')).resolves.toBe(false);
  });

  it.each([
    ['empty', ''],
    ['not a hash at all', 'plaintext'],
    ['truncated', '$argon2id$v=19$m=1024,t=1,p=1$c2FsdA'],
  ])('returns false rather than throwing for a %s stored hash', async (_label, stored) => {
    await expect(service.verify(stored, password)).resolves.toBe(false);
  });
});

describe('PasswordService — the absent-account branch (S-6)', () => {
  const service = new PasswordService(testAuthConfig());

  it('always fails', async () => {
    await expect(service.verifyDummy('anything at all')).resolves.toBe(false);
  });

  it('performs a real verification against a real hash, not an early return', async () => {
    const verify = jest.spyOn(service, 'verify');

    await service.verifyDummy('anything at all');

    expect(verify).toHaveBeenCalledTimes(1);
    const [storedHash] = verify.mock.calls[0];
    // A genuine Argon2id hash — so the work done here matches the work done when the
    // account exists, and the two branches cannot be told apart by timing.
    expect(storedHash.startsWith('$argon2id$')).toBe(true);
  });

  it('reuses one dummy hash, so the absent branch never becomes the slower one', async () => {
    const verify = jest.spyOn(service, 'verify');

    await service.verifyDummy('one');
    await service.verifyDummy('two');

    const [firstHash] = verify.mock.calls[0];
    const [secondHash] = verify.mock.calls[1];
    expect(firstHash).toEqual(secondHash);
  });
});

describe('PasswordService — the S-6 policy', () => {
  const service = new PasswordService(testAuthConfig());

  it.each([
    ['ten characters with a digit and a symbol', 'abcdefg1!x'],
    ['a long passphrase', 'a rather long passphrase 42!'],
  ])('accepts %s', (_label, candidate) => {
    expect(service.satisfiesPolicy(candidate)).toBe(true);
  });

  it.each([
    ['too short', 'abc1!'],
    ['no digit', 'abcdefghij!'],
    ['no symbol', 'abcdefghij1'],
    ['exactly nine characters', 'abcdefg1!'],
    ['absurdly long, which is a hashing DoS', `${'a'.repeat(300)}1!`],
  ])('rejects one that is %s', (_label, candidate) => {
    expect(service.satisfiesPolicy(candidate)).toBe(false);
  });

  it('throws PASSWORD_POLICY_VIOLATION naming the field, never the value', () => {
    expect.assertions(4);
    try {
      service.assertMeetsPolicy('weak', 'newPassword');
    } catch (error) {
      const exception = error as AppException;
      expect(exception).toBeInstanceOf(AppException);
      expect(exception.errorCode).toBe(ErrorCode.PASSWORD_POLICY_VIOLATION);
      expect(exception.errors[0].field).toBe('newPassword');
      expect(JSON.stringify(exception.getAppPayload())).not.toContain('weak');
    }
  });

  it('passes a compliant password through silently', () => {
    expect(() => service.assertMeetsPolicy('abcdefg1!x')).not.toThrow();
  });
});
