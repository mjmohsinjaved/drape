import { authenticator } from 'otplib';

import { FIXED_NOW, freezeClock, setClock } from '../../../../test/setup/time';
import { testAuthConfig } from '../testing/auth-fixtures';

import { PasswordService } from './password.service';
import { normaliseRecoveryCode, TotpService } from './totp.service';

/**
 * PRD S-8 — TOTP enrolment, clock skew and recovery codes.
 *
 * The clock-skew tests freeze time at `FIXED_NOW`, which sits exactly on a 30-second
 * TOTP step boundary — so "one step early" really is one step, and the assertions are
 * about the tolerance window rather than about where the boundary happened to fall.
 */
const STEP_MS = 30_000;

function createService(): TotpService {
  const config = testAuthConfig();
  return new TotpService(config, new PasswordService(config));
}

/** A code as the authenticator app would have produced it at `at`. */
function codeAt(secret: string, at: Date): string {
  setClock(at);
  const code = authenticator.clone({}).generate(secret);
  setClock(FIXED_NOW);
  return code;
}

describe('TotpService — enrolment', () => {
  const service = createService();

  it('mints a secret and a provisioning URI carrying the configured issuer', () => {
    const enrolment = service.enrol('ayesha@example.invalid');

    expect(enrolment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrolment.provisioningUri).toContain('otpauth://totp/');
    expect(enrolment.provisioningUri).toContain('issuer=Drape%20Test');
    expect(enrolment.provisioningUri).toContain(enrolment.secret);
  });

  it('returns ciphertext for the column, never the plaintext secret (§4.3)', () => {
    const enrolment = service.enrol('ayesha@example.invalid');

    expect(enrolment.encryptedSecret).not.toContain(enrolment.secret);
    expect(enrolment.encryptedSecret.startsWith('v1.')).toBe(true);
    expect(service.decryptSecret(enrolment.encryptedSecret)).toEqual(enrolment.secret);
  });
});

describe('TotpService — verification and clock skew', () => {
  const service = createService();
  const secret = authenticator.generateSecret();

  beforeEach(() => {
    freezeClock(FIXED_NOW);
  });

  it('accepts the code for the current step', () => {
    expect(service.verify(secret, codeAt(secret, FIXED_NOW))).toBe(true);
  });

  it.each([
    ['one step early (a phone 30 s behind)', -STEP_MS],
    ['one step late (a phone 30 s ahead)', STEP_MS],
  ])('accepts a code from %s', (_label, offsetMs) => {
    const code = codeAt(secret, new Date(FIXED_NOW.getTime() + offsetMs));

    expect(service.verify(secret, code)).toBe(true);
  });

  it.each([
    ['three steps early', -3 * STEP_MS],
    ['three steps late', 3 * STEP_MS],
  ])('rejects a code from %s — the window is one step, not open-ended', (_label, offsetMs) => {
    const code = codeAt(secret, new Date(FIXED_NOW.getTime() + offsetMs));

    expect(service.verify(secret, code)).toBe(false);
  });

  it.each([
    ['a five-digit code', '12345'],
    ['letters', 'abcdef'],
    ['an empty string', ''],
    ['a seven-digit code', '1234567'],
  ])('rejects %s without throwing', (_label, code) => {
    expect(service.verify(secret, code)).toBe(false);
  });

  it('tolerates whitespace a person typed around a real code', () => {
    const code = codeAt(secret, FIXED_NOW);

    expect(service.verify(secret, ` ${code} `)).toBe(true);
  });

  it('verifies through the stored ciphertext', () => {
    const encrypted = service.encryptSecret(secret);

    expect(service.verifyEncrypted(encrypted, codeAt(secret, FIXED_NOW))).toBe(true);
    expect(service.verifyEncrypted(encrypted, '000000')).toBe(false);
  });

  it('treats an account with no enrolled secret as a failed check, not an error', () => {
    expect(service.verifyEncrypted(null, '123456')).toBe(false);
  });
});

describe('TotpService — secret encryption (AES-256-GCM, §4.3)', () => {
  const service = createService();

  it('produces different ciphertext for the same secret', () => {
    const first = service.encryptSecret('JBSWY3DPEHPK3PXP');
    const second = service.encryptSecret('JBSWY3DPEHPK3PXP');

    expect(first).not.toEqual(second);
    expect(service.decryptSecret(first)).toEqual('JBSWY3DPEHPK3PXP');
    expect(service.decryptSecret(second)).toEqual('JBSWY3DPEHPK3PXP');
  });

  it('refuses tampered ciphertext — the GCM tag is checked, not ignored', () => {
    const envelope = service.encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = envelope.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join('.');

    expect(service.decryptSecret(tampered)).toBeNull();
  });

  it.each([
    ['an unknown version', 'v2.aaaa.bbbb.cccc'],
    ['too few segments', 'v1.aaaa.bbbb'],
    ['an empty string', ''],
    ['a plaintext secret stored by mistake', 'JBSWY3DPEHPK3PXP'],
  ])('returns null for %s', (_label, envelope) => {
    expect(service.decryptSecret(envelope)).toBeNull();
  });

  it('cannot decrypt a secret sealed under a different key', () => {
    const other = new TotpService(
      testAuthConfig({ twofaEncryptionKey: Buffer.alloc(32, 7) }),
      new PasswordService(testAuthConfig()),
    );

    expect(other.decryptSecret(service.encryptSecret('JBSWY3DPEHPK3PXP'))).toBeNull();
  });
});

describe('TotpService — recovery codes (S-8)', () => {
  const service = createService();

  it('returns readable codes and stores only their hashes', async () => {
    const set = await service.generateRecoveryCodes(3);

    expect(set.codes).toHaveLength(3);
    expect(set.hashes).toHaveLength(3);
    for (const [index, code] of set.codes.entries()) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(set.hashes[index]).not.toContain(code);
      expect(set.hashes[index].startsWith('$argon2id$')).toBe(true);
    }
    expect(new Set(set.codes).size).toBe(3);
  });

  it('finds the index of a matching code so the caller can consume exactly one', async () => {
    const set = await service.generateRecoveryCodes(3);

    await expect(service.findRecoveryCodeIndex(set.hashes, set.codes[1])).resolves.toBe(1);
  });

  it('accepts a code typed in lower case without its dash', async () => {
    const set = await service.generateRecoveryCodes(2);
    const typed = set.codes[0].toLowerCase().replace('-', '');

    await expect(service.findRecoveryCodeIndex(set.hashes, typed)).resolves.toBe(0);
  });

  it('returns -1 for a code that was never issued', async () => {
    const set = await service.generateRecoveryCodes(2);

    await expect(service.findRecoveryCodeIndex(set.hashes, 'ZZZZZ-ZZZZZ')).resolves.toBe(-1);
    await expect(service.findRecoveryCodeIndex([], 'ZZZZZ-ZZZZZ')).resolves.toBe(-1);
  });
});

describe('normaliseRecoveryCode', () => {
  it.each([
    ['a2b3c-d4e5f', 'A2B3C-D4E5F'],
    ['A2B3CD4E5F', 'A2B3C-D4E5F'],
    ['  a2b3c d4e5f ', 'A2B3C-D4E5F'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseRecoveryCode(input)).toBe(expected);
  });

  it.each([
    ['too short', 'A2B3C'],
    ['too long', 'A2B3CD4E5FG'],
    ['empty', ''],
  ])('rejects one that is %s', (_label, input) => {
    expect(normaliseRecoveryCode(input)).toBe('');
  });
});
