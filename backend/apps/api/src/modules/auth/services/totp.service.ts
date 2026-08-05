import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { authenticator } from 'otplib';

import { AUTH_CONFIG, RECOVERY_CODE_COUNT } from '../auth.constants';

import { PasswordService } from './password.service';

import type { AuthConfig } from '../config/auth.config';

/**
 * TOTP steps of tolerance either side of "now".
 *
 * One step is 30 seconds, so `[1, 1]` accepts a code up to 30 s early or 30 s late —
 * the standard allowance for an unsynchronised phone clock. Widening it multiplies
 * the number of codes valid at any instant, so it stays at one.
 */
const CLOCK_SKEW_STEPS: [number, number] = [1, 1];

/** A pre-configured authenticator. `clone()` leaves otplib's shared singleton alone. */
const totp = authenticator.clone({ window: CLOCK_SKEW_STEPS });

/** Crockford-ish alphabet: no 0/O, no 1/I/L — a recovery code gets read aloud. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_GROUP_LENGTH = 5;
const RECOVERY_GROUPS = 2;

/** Envelope version, so the format can change without guessing at decryption time. */
const CIPHER_VERSION = 'v1';
const GCM_IV_BYTES = 12;

export interface TwoFactorEnrolment {
  /** Plaintext base32 secret. Shown once, then discarded — only the ciphertext persists. */
  readonly secret: string;
  /** `otpauth://` URI for the QR code. */
  readonly provisioningUri: string;
  /** AES-256-GCM ciphertext for `users.twofaSecret`. */
  readonly encryptedSecret: string;
}

export interface RecoveryCodeSet {
  /** Shown to the operator exactly once (S-8). Never stored, never logged. */
  readonly codes: readonly string[];
  /** What goes in `users.twofaRecoveryCodes`. */
  readonly hashes: readonly string[];
}

/**
 * TOTP enrolment and verification — PRD S-8.
 *
 * 2FA is **mandatory for admins and optional for consumers**; that rule is enforced
 * by `AuthService`, not here. This service knows only about secrets and codes.
 *
 * `users.twofaSecret` holds AES-256-GCM ciphertext under `TWOFA_ENCRYPTION_KEY`,
 * never plaintext (§4.3). The key is 32 bytes; a fresh 12-byte IV is generated per
 * encryption and stored alongside the auth tag, so two accounts enrolling with the
 * same secret produce different ciphertext.
 *
 * **Deviation from §4.3, recorded deliberately:** the column comment says recovery
 * codes are bcrypt hashes. `bcrypt` is not a dependency of this service and adding a
 * second password hasher to satisfy a comment would be worse than reusing the one
 * S-6 already mandates — so recovery codes are hashed with the same Argon2id
 * parameters as passwords, through `PasswordService`. The column type is unchanged.
 */
@Injectable()
export class TotpService {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly passwordService: PasswordService,
  ) {}

  /** Mints a secret and the provisioning URI the authenticator app scans. */
  enrol(accountLabel: string): TwoFactorEnrolment {
    const secret = totp.generateSecret();
    return {
      secret,
      provisioningUri: totp.keyuri(accountLabel, this.config.twofaIssuer, secret),
      encryptedSecret: this.encryptSecret(secret),
    };
  }

  /**
   * Verifies a 6-digit code against a stored (encrypted) secret, tolerating one step
   * of clock skew either way.
   *
   * Returns `false` for a malformed code, an undecryptable secret or a mismatch —
   * the caller turns all three into the same `TWOFA_INVALID`, because telling them
   * apart tells an attacker which accounts are misconfigured.
   */
  verifyEncrypted(encryptedSecret: string | null, code: string): boolean {
    if (encryptedSecret === null) {
      return false;
    }
    const secret = this.decryptSecret(encryptedSecret);
    return secret === null ? false : this.verify(secret, code);
  }

  /** Verifies a code against a plaintext secret — used during enrolment confirmation. */
  verify(secret: string, code: string): boolean {
    const normalised = typeof code === 'string' ? code.replace(/\s+/g, '') : '';
    if (!/^\d{6}$/.test(normalised)) {
      return false;
    }
    try {
      return totp.check(normalised, secret);
    } catch {
      // otplib throws on a secret it cannot decode. That is a failed check.
      return false;
    }
  }

  /** AES-256-GCM. Output shape: `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
  encryptSecret(plaintext: string): string {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.config.twofaEncryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      CIPHER_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /** Reverses `encryptSecret`. Returns `null` for anything that does not authenticate. */
  decryptSecret(envelope: string): string | null {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
      return null;
    }
    try {
      const iv = Buffer.from(parts[1], 'base64url');
      const tag = Buffer.from(parts[2], 'base64url');
      const ciphertext = Buffer.from(parts[3], 'base64url');
      if (iv.length !== GCM_IV_BYTES) {
        return null;
      }
      const decipher = createDecipheriv('aes-256-gcm', this.config.twofaEncryptionKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key, tampered ciphertext, truncated envelope — all indistinguishable
      // by design, and all mean "this secret is unusable".
      return null;
    }
  }

  /** Ten single-use recovery codes, returned in plaintext once and as hashes to store. */
  async generateRecoveryCodes(count = RECOVERY_CODE_COUNT): Promise<RecoveryCodeSet> {
    const codes: string[] = [];
    for (let index = 0; index < count; index += 1) {
      codes.push(this.generateRecoveryCode());
    }
    const hashes = await Promise.all(codes.map((code) => this.passwordService.hash(code)));
    return { codes, hashes };
  }

  /**
   * Finds the index of the hash a recovery code matches, or `-1`.
   *
   * The caller removes that entry, which is what makes a recovery code single-use.
   * Every stored hash is checked even after a match, so the time taken does not
   * depend on which code was used.
   */
  async findRecoveryCodeIndex(hashes: readonly string[], code: string): Promise<number> {
    const normalised = normaliseRecoveryCode(code);
    if (normalised.length === 0) {
      return -1;
    }
    let matched = -1;
    for (const [index, storedHash] of hashes.entries()) {
      if (await this.passwordService.verify(storedHash, normalised)) {
        matched = index;
      }
    }
    return matched;
  }

  private generateRecoveryCode(): string {
    const groups: string[] = [];
    for (let group = 0; group < RECOVERY_GROUPS; group += 1) {
      let characters = '';
      for (let index = 0; index < RECOVERY_GROUP_LENGTH; index += 1) {
        characters += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
      }
      groups.push(characters);
    }
    return groups.join('-');
  }
}

/** Recovery codes are typed by hand: upper-case them and drop spaces and dashes. */
export function normaliseRecoveryCode(code: string): string {
  if (typeof code !== 'string') {
    return '';
  }
  const stripped = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (stripped.length !== RECOVERY_GROUP_LENGTH * RECOVERY_GROUPS) {
    return '';
  }
  const groups: string[] = [];
  for (let index = 0; index < stripped.length; index += RECOVERY_GROUP_LENGTH) {
    groups.push(stripped.slice(index, index + RECOVERY_GROUP_LENGTH));
  }
  return groups.join('-');
}
