import type { ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { CSRF_HEADER_NAME, ErrorCode, SKIP_CSRF_KEY, type ICurrentUser } from '@library/common';

import { buildSession } from '../../../../test/factories';
import { CsrfService } from '../services/csrf.service';
import { testAuthConfig } from '../testing/auth-fixtures';

import { SessionCsrfBindingGuard } from './session-csrf-binding.guard';

import type { Session } from '../entities/session.entity';
import type { SessionService } from '../services/session.service';

const csrfService = new CsrfService(testAuthConfig());

interface HarnessOptions {
  method?: string;
  header?: string;
  user?: ICurrentUser;
  skipCsrf?: boolean;
  session?: Session | null;
  contextType?: string;
}

function createContext(options: HarnessOptions): ExecutionContext {
  const headers: Record<string, string | undefined> = {};
  if (options.header !== undefined) {
    headers[CSRF_HEADER_NAME] = options.header;
  }

  return {
    getType: <T>(): T => (options.contextType ?? 'http') as unknown as T,
    getHandler: () => function handler(): void {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: <T>(): T =>
        ({ method: options.method ?? 'POST', headers, user: options.user }) as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

function createGuard(options: HarnessOptions): SessionCsrfBindingGuard {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === SKIP_CSRF_KEY ? (options.skipCsrf ?? false) : undefined,
    ),
  } as unknown as Reflector;

  const sessionService = {
    findById: jest.fn(async () => options.session ?? null),
  } as unknown as SessionService;

  return new SessionCsrfBindingGuard(reflector, sessionService, csrfService);
}

function activate(options: HarnessOptions): Promise<boolean> {
  return createGuard(options).canActivate(createContext(options));
}

const CALLER = { id: 'user', sessionId: 'session-1' } as ICurrentUser;

/**
 * ARCHITECTURE §2.7 guard 1 — the half `CsrfGuard` cannot do.
 *
 * `CsrfGuard` has already matched the header against the cookie by the time this
 * runs; what is left to prove is that the token was minted for *this* session.
 */
describe('SessionCsrfBindingGuard — when it stands aside', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('skips the safe method %s', async (method) => {
    await expect(activate({ method })).resolves.toBe(true);
  });

  it('skips @SkipCsrf() — the ticket-redemption route carries its credential in the URL', async () => {
    await expect(activate({ method: 'POST', skipCsrf: true, user: CALLER })).resolves.toBe(true);
  });

  it('skips an anonymous caller on a public route', async () => {
    await expect(activate({ method: 'POST' })).resolves.toBe(true);
  });

  it('skips a non-HTTP context', async () => {
    await expect(activate({ contextType: 'rpc' })).resolves.toBe(true);
  });
});

describe('SessionCsrfBindingGuard — the binding check', () => {
  const session = buildSession({ id: 'session-1' });

  it('passes a token minted for this session', async () => {
    const token = csrfService.issueToken(session.csrfSecret);

    await expect(activate({ user: CALLER, header: token, session })).resolves.toBe(true);
  });

  it('rejects a token minted for a different session', async () => {
    const other = buildSession({ id: 'session-2' });
    const token = csrfService.issueToken(other.csrfSecret);

    await expect(activate({ user: CALLER, header: token, session })).rejects.toMatchObject({
      errorCode: ErrorCode.CSRF_TOKEN_INVALID,
    });
  });

  it('rejects an anonymous token once the caller has a session', async () => {
    const token = csrfService.issueToken(null);

    await expect(activate({ user: CALLER, header: token, session })).rejects.toMatchObject({
      errorCode: ErrorCode.CSRF_TOKEN_INVALID,
    });
  });

  it('rejects a missing header with CSRF_TOKEN_MISSING', async () => {
    await expect(activate({ user: CALLER, session })).rejects.toMatchObject({
      errorCode: ErrorCode.CSRF_TOKEN_MISSING,
    });
  });

  it('rejects rather than 500s when the session vanished mid-request', async () => {
    const token = csrfService.issueToken(session.csrfSecret);

    await expect(activate({ user: CALLER, header: token, session: null })).rejects.toMatchObject({
      errorCode: ErrorCode.CSRF_TOKEN_INVALID,
    });
  });

  it('rejects a malformed token without throwing something else', async () => {
    await expect(activate({ user: CALLER, header: 'not-a-token', session })).rejects.toMatchObject({
      errorCode: ErrorCode.CSRF_TOKEN_INVALID,
    });
  });
});
