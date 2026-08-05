import { type AppException, ErrorCode, isSha256Hex, sha256Hex } from '@library/common';

import { uuid } from '../../../../test/factories';
import {
  createServiceUnderTest,
  type TestHarness,
  type InMemoryRepository,
} from '../../../../test/fixtures';
import { FIXED_NOW, freezeClock, minutesFromFixedNow } from '../../../../test/setup/time';
import { OTP_MAX_ATTEMPTS } from '../auth.constants';
import { VerificationToken } from '../entities/verification-token.entity';
import { VerificationPurpose } from '../enums/verification-purpose.enum';

import {
  generateNumericCode,
  VerificationTokenService,
  type IssuedToken,
} from './verification-token.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

/**
 * ARCHITECTURE §4.6, PRD S-6 — single-use verification tokens.
 *
 * The properties under test are the ones a breach depends on: the row never holds the
 * value that was emailed, a token works exactly once, and an expired token is a
 * distinct outcome from a used one so the UI can say the right thing.
 */
describe('VerificationTokenService', () => {
  let harness: TestHarness;
  let service: VerificationTokenService;
  let tokens: InMemoryRepository<VerificationToken>;

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    const created = await createServiceUnderTest(VerificationTokenService, {
      repositories: [VerificationToken],
    });
    service = created.service;
    harness = created.harness;
    tokens = harness.repository<VerificationToken>(VerificationToken);
  });

  afterEach(async () => {
    await harness.close();
  });

  function issue(
    overrides: Partial<Parameters<VerificationTokenService['issue']>[0]> = {},
  ): Promise<IssuedToken> {
    return service.issue({
      userId: USER_ID,
      purpose: VerificationPurpose.PASSWORD_RESET,
      destination: 'ayesha@example.invalid',
      expiresAt: minutesFromFixedNow(30),
      ip: '203.0.113.7',
      ...overrides,
    });
  }

  describe('issue', () => {
    it('returns the token once and stores only its sha256', async () => {
      const issued = await issue();

      expect(issued.token.length).toBeGreaterThan(20);
      expect(isSha256Hex(issued.row.tokenHash)).toBe(true);
      expect(issued.row.tokenHash).toBe(sha256Hex(issued.token));
      expect(JSON.stringify(tokens.$rows)).not.toContain(issued.token);
    });

    it('mints a distinct token every time', async () => {
      const [first, second] = [await issue(), await issue()];

      expect(first.token).not.toEqual(second.token);
    });

    it('mints no OTP unless one was asked for', async () => {
      const issued = await issue();

      expect(issued.code).toBeNull();
      expect(issued.row.codeHash).toBeNull();
    });

    it('mints a six-digit OTP and stores only its hash', async () => {
      const issued = await issue({
        purpose: VerificationPurpose.PHONE_OTP,
        destination: '+923001234567',
        withCode: true,
      });

      expect(issued.code).toMatch(/^\d{6}$/);
      expect(issued.row.codeHash).toBe(sha256Hex(issued.code as string));
      expect(JSON.stringify(tokens.$rows)).not.toContain(issued.code as string);
    });

    it('retires the previous outstanding token for the same purpose (S-6)', async () => {
      const first = await issue();
      await issue();

      await expect(
        service.consume(first.token, VerificationPurpose.PASSWORD_RESET, FIXED_NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TOKEN_ALREADY_USED });
    });

    it('leaves a token of a different purpose alone', async () => {
      const verification = await issue({ purpose: VerificationPurpose.EMAIL_VERIFICATION });
      await issue({ purpose: VerificationPurpose.PASSWORD_RESET });

      await expect(
        service.consume(verification.token, VerificationPurpose.EMAIL_VERIFICATION, FIXED_NOW),
      ).resolves.toMatchObject({ userId: USER_ID });
    });
  });

  describe('consume', () => {
    it('marks the row consumed and returns it', async () => {
      const issued = await issue();

      const row = await service.consume(
        issued.token,
        VerificationPurpose.PASSWORD_RESET,
        FIXED_NOW,
      );

      expect(row.consumedAt).toEqual(FIXED_NOW);
      expect(tokens.$rows[0].consumedAt).toEqual(FIXED_NOW);
    });

    it('is single use — the second attempt is TOKEN_ALREADY_USED', async () => {
      const issued = await issue();
      await service.consume(issued.token, VerificationPurpose.PASSWORD_RESET, FIXED_NOW);

      await expect(
        service.consume(issued.token, VerificationPurpose.PASSWORD_RESET, FIXED_NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TOKEN_ALREADY_USED });
    });

    it('rejects a token past its 30-minute TTL with TOKEN_EXPIRED (S-6)', async () => {
      const issued = await issue({ expiresAt: minutesFromFixedNow(30) });

      await expect(
        service.consume(issued.token, VerificationPurpose.PASSWORD_RESET, minutesFromFixedNow(31)),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TOKEN_EXPIRED });
    });

    it.each([
      ['an unknown token', 'not-a-real-token'],
      ['an empty token', ''],
    ])('rejects %s with TOKEN_INVALID', async (_label, token) => {
      await expect(
        service.consume(token, VerificationPurpose.PASSWORD_RESET, FIXED_NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TOKEN_INVALID });
    });

    it('will not let a reset token be spent as an email verification', async () => {
      const issued = await issue({ purpose: VerificationPurpose.PASSWORD_RESET });

      await expect(
        service.consume(issued.token, VerificationPurpose.EMAIL_VERIFICATION, FIXED_NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.TOKEN_INVALID });
    });

    it('reports expiry and reuse distinctly, so the UI can say the right thing', async () => {
      const issued = await issue();
      await service.consume(issued.token, VerificationPurpose.PASSWORD_RESET, FIXED_NOW);

      const reuse = await service
        .consume(issued.token, VerificationPurpose.PASSWORD_RESET, FIXED_NOW)
        .catch((error: AppException) => error.errorCode);

      expect(reuse).toBe(ErrorCode.TOKEN_ALREADY_USED);
      expect(reuse).not.toBe(ErrorCode.TOKEN_EXPIRED);
    });
  });

  describe('verifyOtp (C-3)', () => {
    function issueOtp(): Promise<IssuedToken> {
      return issue({
        purpose: VerificationPurpose.PHONE_OTP,
        destination: '+923001234567',
        expiresAt: minutesFromFixedNow(10),
        withCode: true,
      });
    }

    it('consumes the code on a match', async () => {
      const issued = await issueOtp();

      const row = await service.verifyOtp(USER_ID, issued.code as string, FIXED_NOW);

      expect(row.consumedAt).toEqual(FIXED_NOW);
    });

    it('counts a wrong code and reports OTP_INVALID', async () => {
      const issued = await issueOtp();
      const wrong = issued.code === '000000' ? '111111' : '000000';

      await expect(service.verifyOtp(USER_ID, wrong, FIXED_NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.OTP_INVALID,
      });
      expect(tokens.$rows[0].attempts).toBe(1);
    });

    it('burns the code after OTP_MAX_ATTEMPTS wrong guesses', async () => {
      const issued = await issueOtp();
      const wrong = issued.code === '000000' ? '111111' : '000000';

      for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
        await expect(service.verifyOtp(USER_ID, wrong, FIXED_NOW)).rejects.toMatchObject({
          errorCode: ErrorCode.OTP_INVALID,
        });
      }

      await expect(service.verifyOtp(USER_ID, wrong, FIXED_NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.OTP_MAX_ATTEMPTS,
      });
      // Even the right code is worthless now.
      await expect(
        service.verifyOtp(USER_ID, issued.code as string, FIXED_NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.OTP_MAX_ATTEMPTS });
    });

    it('reports OTP_EXPIRED once the TTL has passed', async () => {
      const issued = await issueOtp();

      await expect(
        service.verifyOtp(USER_ID, issued.code as string, minutesFromFixedNow(11)),
      ).rejects.toMatchObject({ errorCode: ErrorCode.OTP_EXPIRED });
    });

    it('reports OTP_EXPIRED when no code was ever sent', async () => {
      await expect(service.verifyOtp(USER_ID, '123456', FIXED_NOW)).rejects.toMatchObject({
        errorCode: ErrorCode.OTP_EXPIRED,
      });
    });

    it('will not accept another account’s code', async () => {
      const issued = await issueOtp();

      await expect(
        service.verifyOtp(uuid(), issued.code as string, FIXED_NOW),
      ).rejects.toMatchObject({ errorCode: ErrorCode.OTP_EXPIRED });
    });
  });

  describe('consumeOutstanding', () => {
    it('retires every live token of one purpose and reports how many', async () => {
      // Two rows of the same purpose, written straight to the fixture so `issue`'s
      // own retirement does not do the work under test.
      tokens.$rows.push(
        {
          id: uuid(),
          userId: USER_ID,
          purpose: VerificationPurpose.PHONE_OTP,
          consumedAt: null,
        } as VerificationToken,
        {
          id: uuid(),
          userId: USER_ID,
          purpose: VerificationPurpose.PHONE_OTP,
          consumedAt: null,
        } as VerificationToken,
      );

      await expect(
        service.consumeOutstanding(USER_ID, VerificationPurpose.PHONE_OTP),
      ).resolves.toBe(2);
    });
  });
});

describe('generateNumericCode', () => {
  it('always returns the requested number of digits, leading zeros included', () => {
    for (let iteration = 0; iteration < 200; iteration += 1) {
      expect(generateNumericCode(6)).toMatch(/^\d{6}$/);
    }
  });

  it('does not collapse to a single value', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateNumericCode(6)));

    expect(seen.size).toBeGreaterThan(1);
  });
});
