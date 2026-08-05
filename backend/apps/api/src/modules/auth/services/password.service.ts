import { Inject, Injectable } from '@nestjs/common';

import { argon2id, hash as argon2Hash, verify as argon2Verify } from 'argon2';

import { ErrorCode, randomToken, ValidationException } from '@library/common';

import { AUTH_CONFIG, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth.constants';

import type { AuthConfig } from '../config/auth.config';

const DIGIT = /[0-9]/;
const SYMBOL = /[^A-Za-z0-9]/;

/**
 * Argon2id password hashing — PRD S-6, ARCHITECTURE §4.3.
 *
 * Two behaviours here are acceptance criteria rather than conveniences:
 *
 * 1. **`verify()` never throws.** A malformed or truncated stored hash is a `false`,
 *    not a 500 — otherwise a corrupted row would tell an attacker that the row
 *    exists.
 * 2. **`verifyDummy()` does the same work as a real verification.** Login must take
 *    the same time whether or not the account exists (S-6), so the "no such account"
 *    branch hashes against a throw-away hash computed with the *same* cost
 *    parameters instead of returning early.
 *
 * Nothing in this file logs. A password never reaches a log line, an exception
 * message or a metric tag (E-12).
 */
@Injectable()
export class PasswordService {
  /**
   * Computed once, lazily, and reused. Generating it per call would make the absent-
   * account branch *slower* than the present-account branch, which is the same
   * oracle in reverse.
   */
  private dummyHash: Promise<string> | undefined;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  /** Hashes a plaintext password with the §7 Argon2id cost parameters. */
  async hash(plaintext: string): Promise<string> {
    return argon2Hash(plaintext, {
      type: argon2id,
      memoryCost: this.config.argon2.memoryCost,
      timeCost: this.config.argon2.timeCost,
      parallelism: this.config.argon2.parallelism,
    });
  }

  /** Verifies a plaintext against a stored hash. Returns `false` on any failure. */
  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    if (typeof storedHash !== 'string' || storedHash.length === 0) {
      return false;
    }
    try {
      return await argon2Verify(storedHash, plaintext);
    } catch {
      // A hash this library cannot parse is a failed verification, not an error.
      return false;
    }
  }

  /**
   * The constant-work path for "no account with that email".
   *
   * Always resolves `false`. The caller treats it exactly like a failed
   * verification, so the two branches are indistinguishable in both response and
   * timing (S-6).
   */
  async verifyDummy(plaintext: string): Promise<boolean> {
    return this.verify(await this.getDummyHash(), plaintext);
  }

  /**
   * PRD S-6 password policy, matching the `PASSWORD_POLICY_VIOLATION` copy exactly:
   * at least 10 characters, including a number and a symbol.
   *
   * @throws {ValidationException} `PASSWORD_POLICY_VIOLATION`
   */
  assertMeetsPolicy(plaintext: string, field = 'password'): void {
    if (!this.satisfiesPolicy(plaintext)) {
      throw new ValidationException(ErrorCode.PASSWORD_POLICY_VIOLATION, {
        // The field name only — never the value that failed.
        errors: [
          {
            field,
            message:
              'Choose a password with at least 10 characters, including a number and a symbol.',
            code: ErrorCode.PASSWORD_POLICY_VIOLATION,
          },
        ],
      });
    }
  }

  /** The policy predicate, without the throw. */
  satisfiesPolicy(plaintext: string): boolean {
    return (
      typeof plaintext === 'string' &&
      plaintext.length >= PASSWORD_MIN_LENGTH &&
      plaintext.length <= PASSWORD_MAX_LENGTH &&
      DIGIT.test(plaintext) &&
      SYMBOL.test(plaintext)
    );
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hash(randomToken(32));
    return this.dummyHash;
  }
}
