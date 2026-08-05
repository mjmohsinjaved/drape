import { AppException, ConflictException, ErrorCode, Locale, Role } from '@library/common';

import type { InviteAcceptance } from '@api/modules/invites/interfaces/invite-acceptance.interface';
import { type InvitesService } from '@api/modules/invites/services/invites.service';
import { createTransactionalDataSource } from '@api/modules/users/testing/query-doubles';

import { buildSession } from '../../../../test/factories';
import { createInMemoryRepository, createMock } from '../../../../test/fixtures';
import { type Session } from '../entities/session.entity';
import { testAuthConfig } from '../testing/auth-fixtures';

import { CsrfService } from './csrf.service';
import { InviteAcceptanceService } from './invite-acceptance.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

import type { AcceptInviteDto } from '../dto/accept-invite.dto';
import type {
  CreateInvitedAccountInput,
  CreateInvitedAccountOptions,
  InvitedAccountDirectory,
} from '../interfaces/invited-account-directory.interface';
import type { AuthUser } from '../interfaces/user-directory.interface';
import type { EntityManager } from 'typeorm';

/**
 * **PRD S-5 — `POST /invites/token/:token/accept`.**
 *
 * > "Admin accounts are created only by the deployment seed script or by invitation
 * > from an existing Admin, accepted through a single-use emailed token."
 *
 * Which makes exactly one property worth proving over and over: **the role and the
 * address come from the invite row, and nothing a caller sends can change either.**
 * `AcceptInviteDto` has no field for them, so the compiler enforces it for
 * well-formed code — and the first test below enforces it for the code that is not,
 * by handing the service a body that carries `role: 'ADMIN'` and an attacker's email
 * anyway.
 *
 * The second property is atomicity (§2.9 rule 3): the token burn and the account
 * insert commit together, or neither does. An invitation spent with no account behind
 * it is unrecoverable — the raw token was never stored, so nobody can re-present it.
 */
describe('InviteAcceptanceService — S-5', () => {
  const INVITER_ID = 'a0000000-0000-4000-8000-00000000000a';
  const RAW_TOKEN = 'a'.repeat(43);

  const facts = { ip: '203.0.113.7', userAgent: 'jest/drape-test' };

  let invites: jest.Mocked<InvitesService>;
  let accounts: jest.Mocked<InvitedAccountDirectory>;
  let created: CreateInvitedAccountInput[];
  let managersSeen: Array<EntityManager | undefined>;
  let state: { started: number; committed: number; rolledBack: number };
  let service: InviteAcceptanceService;
  let sessions: ReturnType<typeof createInMemoryRepository<Session>>;

  /** What the invite row says. Never what the request body says. */
  function acceptance(overrides: Partial<InviteAcceptance> = {}): InviteAcceptance {
    return {
      inviteId: 'b0000000-0000-4000-8000-00000000000b',
      email: 'invited.admin@example.invalid',
      role: Role.ADMIN,
      invitedBy: INVITER_ID,
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function body(overrides: Partial<AcceptInviteDto> = {}): AcceptInviteDto {
    return { name: '  Bilal Ahmed  ', password: 'correct-horse-9!', ...overrides };
  }

  beforeEach(() => {
    created = [];
    managersSeen = [];
    sessions = createInMemoryRepository<Session>();

    invites = createMock<InvitesService>(['consumeToken']);
    invites.consumeToken.mockImplementation(
      (_token: string, _userId: string, options: { manager?: EntityManager } = {}) => {
        managersSeen.push(options.manager);
        return Promise.resolve(acceptance());
      },
    );

    accounts = createMock<InvitedAccountDirectory>(['createInvitedAccount']);
    accounts.createInvitedAccount.mockImplementation(
      (input: CreateInvitedAccountInput, options: CreateInvitedAccountOptions = {}) => {
        created.push(input);
        managersSeen.push(options.manager);
        return Promise.resolve({
          id: input.id,
          role: input.role,
          email: input.email,
          emailVerifiedAt: input.emailVerifiedAt,
          passwordHash: input.passwordHash,
          name: input.name,
          phone: null,
          phoneVerifiedAt: null,
          twofaSecret: null,
          twofaEnabledAt: null,
          twofaRecoveryCodes: null,
          status: 'ACTIVE' as AuthUser['status'],
          lastLoginAt: null,
          lastActiveAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          locale: input.locale,
          deletionRequestedAt: null,
        });
      },
    );

    const config = testAuthConfig();
    const transactional = createTransactionalDataSource({} as unknown as EntityManager);
    state = transactional.state;

    service = new InviteAcceptanceService(
      invites,
      accounts,
      new PasswordService(config),
      new SessionService(sessions, config, new CsrfService(config)),
      transactional.dataSource,
    );
  });

  /* ---------------------------------------------------------------------------------------
   * The role and the address
   * ------------------------------------------------------------------------------------ */

  describe('the invite row decides who becomes an admin', () => {
    it('creates the account for the invited address, not one from the body', async () => {
      // A body carrying fields the DTO does not declare. The validation pipe runs with
      // `forbidNonWhitelisted` and would reject this in production; the point here is
      // that even if it arrived, no code path reads it.
      const hostile = {
        ...body(),
        email: 'attacker@example.invalid',
        role: Role.ADMIN,
        invitedBy: 'someone-else',
      } as AcceptInviteDto;

      await service.accept(RAW_TOKEN, hostile, facts);

      expect(created).toHaveLength(1);
      expect(created[0].email).toBe('invited.admin@example.invalid');
      expect(created[0].invitedBy).toBe(INVITER_ID);
    });

    it('takes the role from the row — a consumer invite cannot become an admin account', async () => {
      invites.consumeToken.mockResolvedValue(acceptance({ role: Role.CONSUMER }));

      await service.accept(RAW_TOKEN, body(), facts);

      expect(created[0].role).toBe(Role.CONSUMER);
    });

    it('records the account against the token it burned', async () => {
      await service.accept(RAW_TOKEN, body(), facts);

      const [, consumedByUserId] = invites.consumeToken.mock.calls[0];
      expect(consumedByUserId).toBe(created[0].id);
    });

    it('trims the name and defaults the locale, and never stores the plaintext password', async () => {
      await service.accept(RAW_TOKEN, body(), facts);

      expect(created[0].name).toBe('Bilal Ahmed');
      expect(created[0].locale).toBe(Locale.EN);
      expect(created[0].passwordHash).toMatch(/^\$argon2id\$/);
      expect(JSON.stringify(created)).not.toContain('correct-horse-9!');
    });

    it('marks the address verified — redeeming the emailed token is the proof', async () => {
      await service.accept(RAW_TOKEN, body(), facts);

      expect(created[0].emailVerifiedAt).toBeInstanceOf(Date);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * One transaction (§2.9 rule 3)
   * ------------------------------------------------------------------------------------ */

  describe('the burn and the insert are one unit of work', () => {
    it('hands the same manager to both sides', async () => {
      await service.accept(RAW_TOKEN, body(), facts);

      expect(state.started).toBe(1);
      expect(state.committed).toBe(1);
      expect(managersSeen).toHaveLength(2);
      expect(managersSeen[0]).toBeDefined();
      expect(managersSeen[0]).toBe(managersSeen[1]);
    });

    it('rolls back — leaving the invitation unspent — when the account cannot be created', async () => {
      accounts.createInvitedAccount.mockRejectedValue(
        new ConflictException(ErrorCode.EMAIL_ALREADY_EXISTS),
      );

      expect(await errorCodeOf(service.accept(RAW_TOKEN, body(), facts))).toBe(
        ErrorCode.EMAIL_ALREADY_EXISTS,
      );
      expect(state.committed).toBe(0);
      expect(state.rolledBack).toBe(1);
    });

    it('propagates INVITE_ALREADY_CONSUMED and creates nothing', async () => {
      invites.consumeToken.mockRejectedValue(
        new ConflictException(ErrorCode.INVITE_ALREADY_CONSUMED),
      );

      expect(await errorCodeOf(service.accept(RAW_TOKEN, body(), facts))).toBe(
        ErrorCode.INVITE_ALREADY_CONSUMED,
      );
      expect(created).toHaveLength(0);
      expect(sessions.$rows).toHaveLength(0);
    });

    it('refuses a weak password BEFORE the token is touched (S-6)', async () => {
      expect(await errorCodeOf(service.accept(RAW_TOKEN, body({ password: 'short' }), facts))).toBe(
        ErrorCode.PASSWORD_POLICY_VIOLATION,
      );
      // The single-use token survives a rejected password: the raw value was never
      // stored, so burning it here would strand the invitation for good.
      expect(invites.consumeToken).not.toHaveBeenCalled();
      expect(state.started).toBe(0);
    });
  });

  /* ---------------------------------------------------------------------------------------
   * The session the new admin gets (S-8)
   * ------------------------------------------------------------------------------------ */

  describe('the session it issues', () => {
    it('signs the new admin in so the forced 2FA enrolment is reachable', async () => {
      const result = await service.accept(RAW_TOKEN, body(), facts);

      expect(result.issued).toBeDefined();
      expect(result.issued?.session.userId).toBe(created[0].id);
      expect(result.issued?.session.role).toBe(Role.ADMIN);
      expect(result.issued?.csrfToken).toEqual(expect.any(String));
    });

    it('is not twofaPending — there is no secret to challenge against yet', async () => {
      const result = await service.accept(RAW_TOKEN, body(), facts);

      expect(result.issued?.session.twofaPending).toBe(false);
    });

    it('stores only the hash of the cookie value (§4.5)', async () => {
      const result = await service.accept(RAW_TOKEN, body(), facts);

      expect(JSON.stringify(sessions.$rows)).not.toContain(result.issued?.token);
    });

    it('returns a DTO carrying no credential', async () => {
      const result = await service.accept(RAW_TOKEN, body(), facts);
      const serialised = JSON.stringify(result.body);

      expect(result.body.email).toBe('invited.admin@example.invalid');
      expect(result.body.role).toBe(Role.ADMIN);
      expect(serialised).not.toContain('passwordHash');
      expect(serialised).not.toContain('argon2');
    });
  });

  /** A session fixture is enough to prove the repository double is wired sanely. */
  it('writes its session into the sessions table', async () => {
    sessions.$seed([buildSession()]);

    await service.accept(RAW_TOKEN, body(), facts);

    expect(sessions.$rows).toHaveLength(2);
  });

  async function errorCodeOf(work: Promise<unknown>): Promise<ErrorCode | undefined> {
    try {
      await work;
      return undefined;
    } catch (error) {
      return error instanceof AppException ? error.errorCode : undefined;
    }
  }
});
