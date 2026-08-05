import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, LessThan, Repository } from 'typeorm';

import {
  AppException,
  AuthException,
  ErrorCode,
  randomToken,
  sha256Hex,
  timingSafeEqualString,
} from '@library/common';

import { OTP_DIGITS, OTP_MAX_ATTEMPTS, VERIFICATION_TOKEN_BYTES } from '../auth.constants';
import { VerificationToken } from '../entities/verification-token.entity';
import { VerificationPurpose } from '../enums/verification-purpose.enum';

export interface IssueTokenInput {
  readonly userId: string | null;
  readonly purpose: VerificationPurpose;
  /** Email address or E.164 number the token was sent to. */
  readonly destination: string;
  readonly expiresAt: Date;
  readonly ip: string | null;
  /** Also mint a 6-digit OTP (`PHONE_OTP` only). */
  readonly withCode?: boolean;
}

export interface IssuedToken {
  /** The opaque value that goes in the link. Returned once; only its sha256 is stored. */
  readonly token: string;
  /** The 6-digit OTP, when one was requested. Never logged (E-12). */
  readonly code: string | null;
  readonly row: VerificationToken;
}

/**
 * Single-use verification tokens — ARCHITECTURE §4.6.
 *
 * Everything here follows one rule: **the server stores a sha256, never the value it
 * sent**. A dump of `verification_tokens` therefore lets nobody reset a password,
 * confirm an address or complete an OTP.
 *
 * Consumption is a conditional UPDATE (`WHERE consumedAt IS NULL`) whose affected-row
 * count is the answer, not a read-then-write. Two clicks on the same reset link race
 * for one row and exactly one wins — the other gets `TOKEN_ALREADY_USED`.
 */
@Injectable()
export class VerificationTokenService {
  constructor(
    @InjectRepository(VerificationToken)
    private readonly tokens: Repository<VerificationToken>,
  ) {}

  /**
   * Issues a token, first retiring any outstanding one for the same user and
   * purpose. Requesting a second reset link must invalidate the first (S-6).
   */
  async issue(input: IssueTokenInput): Promise<IssuedToken> {
    if (input.userId !== null) {
      await this.consumeOutstanding(input.userId, input.purpose);
    }

    const token = randomToken(VERIFICATION_TOKEN_BYTES);
    const code = input.withCode === true ? generateNumericCode(OTP_DIGITS) : null;

    const row = this.tokens.create({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: sha256Hex(token),
      codeHash: code === null ? null : sha256Hex(code),
      destination: input.destination,
      expiresAt: input.expiresAt,
      consumedAt: null,
      attempts: 0,
      ip: input.ip,
    });

    return { token, code, row: await this.tokens.save(row) };
  }

  /**
   * Consumes an emailed token.
   *
   * @throws {AppException} `TOKEN_INVALID` (unknown or wrong purpose),
   * `TOKEN_EXPIRED`, `TOKEN_ALREADY_USED`.
   */
  async consume(
    token: string,
    purpose: VerificationPurpose,
    now: Date,
  ): Promise<VerificationToken> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppException(ErrorCode.TOKEN_INVALID);
    }

    const row = await this.tokens.findOne({
      where: { tokenHash: sha256Hex(token), purpose },
    });

    if (row === null) {
      throw new AppException(ErrorCode.TOKEN_INVALID);
    }
    if (row.consumedAt !== null) {
      throw new AppException(ErrorCode.TOKEN_ALREADY_USED);
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      throw new AppException(ErrorCode.TOKEN_EXPIRED);
    }

    // The conditional update is what makes this single-use under concurrency.
    const result = await this.tokens.update(
      { id: row.id, consumedAt: IsNull() },
      { consumedAt: now },
    );
    if ((result.affected ?? 0) !== 1) {
      throw new AppException(ErrorCode.TOKEN_ALREADY_USED);
    }

    row.consumedAt = now;
    return row;
  }

  /**
   * Verifies a phone OTP against the newest outstanding code for the user.
   *
   * @throws {AuthException} `OTP_EXPIRED` when there is no live code,
   * `OTP_MAX_ATTEMPTS` once the code is burned, `OTP_INVALID` on a mismatch.
   */
  async verifyOtp(userId: string, code: string, now: Date): Promise<VerificationToken> {
    const row = await this.tokens.findOne({
      where: {
        userId,
        purpose: VerificationPurpose.PHONE_OTP,
        consumedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    if (row === null || row.expiresAt.getTime() <= now.getTime()) {
      throw new AuthException(ErrorCode.OTP_EXPIRED);
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AuthException(ErrorCode.OTP_MAX_ATTEMPTS);
    }

    const submitted = typeof code === 'string' ? code.trim() : '';
    const matches =
      row.codeHash !== null && timingSafeEqualString(sha256Hex(submitted), row.codeHash);

    if (!matches) {
      row.attempts += 1;
      await this.tokens.save(row);
      throw new AuthException(
        row.attempts >= OTP_MAX_ATTEMPTS ? ErrorCode.OTP_MAX_ATTEMPTS : ErrorCode.OTP_INVALID,
      );
    }

    const result = await this.tokens.update(
      { id: row.id, consumedAt: IsNull() },
      { consumedAt: now },
    );
    if ((result.affected ?? 0) !== 1) {
      throw new AuthException(ErrorCode.OTP_MAX_ATTEMPTS);
    }

    row.consumedAt = now;
    return row;
  }

  /** Retires every outstanding token of one purpose for one user. */
  async consumeOutstanding(userId: string, purpose: VerificationPurpose): Promise<number> {
    const result = await this.tokens.update(
      { userId, purpose, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  /** Retention helper: drops rows that expired before `before`. */
  async purgeExpired(before: Date): Promise<number> {
    const result = await this.tokens.delete({ expiresAt: LessThan(before) });
    return result.affected ?? 0;
  }
}

/**
 * A uniformly-distributed decimal code.
 *
 * `randomInt` rather than `Math.random`: an OTP is a credential, and a predictable
 * one is no credential at all. Leading zeros are preserved by padding, so every code
 * really has `10^digits` possibilities.
 */
export function generateNumericCode(digits: number): string {
  const ceiling = 10 ** digits;
  return String(randomInt(0, ceiling)).padStart(digits, '0');
}
