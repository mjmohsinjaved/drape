import { Controller, Get, Post, VersioningType, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import cookieParser from 'cookie-parser';
import request from 'supertest';

import {
  CsrfGuard,
  CustomValidationPipe,
  ErrorCode,
  GlobalExceptionFilter,
  Public,
  Role,
  Roles,
  SessionAuthGuard,
  SESSION_RESOLVER,
  RolesGuard,
} from '@library/common';

import { registerBodyParsers } from '@api/bootstrap/body-parser.config';
import { AUTH_CONFIG, USER_DIRECTORY } from '@api/modules/auth/auth.constants';
import { AuthController } from '@api/modules/auth/controllers/auth.controller';
import { Session } from '@api/modules/auth/entities/session.entity';
import type { AuthUser } from '@api/modules/auth/interfaces/user-directory.interface';
import { AuthService } from '@api/modules/auth/services/auth.service';
import { CsrfService } from '@api/modules/auth/services/csrf.service';
import { SessionResolverService } from '@api/modules/auth/services/session-resolver.service';
import { SessionService } from '@api/modules/auth/services/session.service';
import {
  buildAuthUser,
  createFakeUserDirectory,
  testAuthConfig,
  type FakeUserDirectory,
} from '@api/modules/auth/testing/auth-fixtures';

import { createInMemoryRepository, type InMemoryRepository } from '../fixtures';
import { FIXED_NOW, freezeClock } from '../setup/time';

/**
 * **The guard chain, over real HTTP.**
 *
 * Every other suite in this repository resolves a service, or a guard, in isolation. Two of
 * the findings these tests cover were invisible to that style precisely because they lived in
 * the *composition*: a decorator that switched a guard off, and a check that no guard
 * performed. So this file boots a Nest application with the §2.7 guards registered as real
 * `APP_GUARD`s, the real `SessionResolverService` behind `SESSION_RESOLVER`, the real
 * `GlobalExceptionFilter`, the global prefix and URI versioning — and then makes requests with
 * supertest. Nothing about the chain is mocked; only the database is (in-memory repositories)
 * and, in the CSRF suite, `AuthService`, whose behaviour is not what is under test.
 */

const CSRF_COOKIE = 'drape.csrf';
const SESSION_COOKIE = 'drape.sid';
const CSRF_HEADER = 'X-CSRF-Token';

/** Applies the §5 routing surface, so paths under test are the real `/api/v1/**`. */
async function boot(app: NestExpressApplication): Promise<INestApplication> {
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new CustomValidationPipe());
  registerBodyParsers(app);
  await app.init();
  return app;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * HIGH-1 — login and signup are CSRF-protected
 * ════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `POST /auth/login` and `POST /auth/signup` used to carry `@SkipCsrf()`, justified as "no
 * session-bound CSRF secret exists yet". `GET /auth/csrf` mints an **anonymous-scope** token
 * for exactly that case, and `POST /invites/token/:token/accept` had always used it — so the
 * skip bought nothing and cost the property below.
 *
 * What it cost: Nest registers `express.urlencoded({ extended: true })` by default, and a
 * cross-site auto-submitting form with that content type is a *simple request*. No preflight,
 * so `enableCors()` never gets a vote, and `LoginDto` is satisfied by two hidden inputs. An
 * attacker signs a visitor silently into an account **he** controls; she then uploads her
 * photograph and builds a shortlist inside it, and he reads all of it.
 *
 * Two independent defences are asserted here — the guard, and the absence of the transport.
 */
describe('POST /auth/login and /auth/signup — CSRF (HIGH-1)', () => {
  let app: INestApplication;
  let authService: { login: jest.Mock; signup: jest.Mock };
  let csrf: CsrfService;

  const credentials = { email: 'victim@example.invalid', password: 'correct-horse-9!' };

  beforeAll(async () => {
    freezeClock(FIXED_NOW);
    const config = testAuthConfig();

    authService = {
      login: jest.fn().mockResolvedValue({
        body: { user: null, twofaRequired: false },
      }),
      signup: jest.fn().mockResolvedValue({ body: { id: 'u1' } }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        CsrfService,
        { provide: AUTH_CONFIG, useValue: config },
        { provide: AuthService, useValue: authService },
        {
          provide: SessionService,
          useValue: { findById: jest.fn().mockResolvedValue(null), writeAuthCookies: jest.fn() },
        },
        // The real guards 1 and 4. Guard 3 is not registered: both routes are
        // `@Public()`, so it would stand aside anyway, and leaving it out keeps this
        // suite about CSRF alone.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    csrf = moduleRef.get(CsrfService);
    app = await boot(
      // The same two lines `main.ts` uses: Nest's default pair includes
      // `express.urlencoded()`, and `registerBodyParsers` puts back JSON alone.
      moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    authService.login.mockClear();
    authService.signup.mockClear();
  });

  /** A token from the anonymous scope — what `GET /auth/csrf` hands a caller with no session. */
  function anonymousToken(): string {
    return csrf.issueToken(null);
  }

  describe('a forged cross-site request', () => {
    it.each([
      ['login', '/api/v1/auth/login'],
      ['signup', '/api/v1/auth/signup'],
    ])('refuses %s with no CSRF token at all', async (_label, path) => {
      const response = await request(app.getHttpServer()).post(path).send(credentials);

      expect(response.status).toBe(403);
      expect(response.body.errorCode).toBe(ErrorCode.CSRF_TOKEN_MISSING);
      expect(authService.login).not.toHaveBeenCalled();
      expect(authService.signup).not.toHaveBeenCalled();
    });

    it('refuses login when the header does not match the cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', `${CSRF_COOKIE}=${anonymousToken()}`)
        .set(CSRF_HEADER, anonymousToken().slice(0, -1) + 'x')
        .send(credentials);

      expect(response.status).toBe(403);
      expect(response.body.errorCode).toBe(ErrorCode.CSRF_TOKEN_INVALID);
      expect(authService.login).not.toHaveBeenCalled();
    });

    /**
     * A cross-site `<form>` can only produce `application/x-www-form-urlencoded`,
     * `multipart/form-data` or `text/plain` — never `application/json`. Refusing to parse the
     * first is defence in depth behind the guard: even a request that somehow satisfied the
     * double-submit cannot deliver credentials through a form.
     */
    it('never parses a urlencoded body, so a form cannot deliver credentials', async () => {
      const token = anonymousToken();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', `${CSRF_COOKIE}=${token}`)
        .set(CSRF_HEADER, token)
        .type('form')
        .send(credentials);

      expect(response.status).not.toBe(200);
      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('the real login form', () => {
    it('succeeds with the anonymous-scope token from GET /auth/csrf', async () => {
      const token = anonymousToken();

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Cookie', `${CSRF_COOKIE}=${token}`)
        .set(CSRF_HEADER, token)
        .send(credentials);

      expect(response.status).toBe(200);
      expect(authService.login).toHaveBeenCalledWith(
        credentials.email,
        credentials.password,
        expect.anything(),
      );
    });

    it('issues that token without a session, which is what makes the above possible', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/auth/csrf');

      expect(response.status).toBe(200);
      expect(String(response.headers['set-cookie'])).toContain(CSRF_COOKIE);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * S-8 — a second factor is opt-in, and the guard chain says so
 * ════════════════════════════════════════════════════════════════════════════════════════ */

/** Stand-ins for the console surface and the enrolment surface, both open to any admin. */
@Controller('admin')
class AdminProbeController {
  @Get('consumers')
  @Roles(Role.ADMIN)
  list(): { ok: true } {
    return { ok: true };
  }
}

@Controller('auth')
class EnrolmentProbeController {
  @Get('me')
  @Roles(Role.ADMIN, Role.CONSUMER)
  me(): { ok: true } {
    return { ok: true };
  }

  @Post('2fa/setup')
  @Roles(Role.ADMIN, Role.CONSUMER)
  setup(): { ok: true } {
    return { ok: true };
  }

  @Get('browse')
  @Public()
  @Roles(Role.PUBLIC)
  browse(): { ok: true } {
    return { ok: true };
  }
}

/**
 * A second factor is **opt-in for every role** (S-8): nothing forces enrolment, and an account
 * that has not enrolled is authorised on exactly the routes its role allows.
 *
 * This used to be the opposite — an un-enrolled admin was refused everywhere outside a
 * four-route enrolment allow-list, so a freshly seeded operator met a 401 on every console
 * call. These cases drive the real `SessionAuthGuard` → real `SessionResolverService` → real
 * `RolesGuard` over HTTP, with a real session row addressed by a real cookie, so a re-added
 * enrolment gate cannot pass unnoticed.
 */
describe('an ADMIN with no second factor enrolled (S-8)', () => {
  let app: INestApplication;
  let sessions: SessionService;
  let directory: FakeUserDirectory;
  let sessionRows: InMemoryRepository<Session>;

  async function signIn(user: AuthUser): Promise<string> {
    directory.rows.push(user);
    const issued = await sessions.issue({
      user,
      ip: '203.0.113.7',
      userAgent: 'jest/drape-test',
      twofaPending: false,
      now: new Date(),
    });
    return issued.token;
  }

  function admin(overrides: Partial<AuthUser> = {}): AuthUser {
    return buildAuthUser({
      id: '22222222-2222-4222-8222-222222222222',
      role: Role.ADMIN,
      email: 'admin@example.invalid',
      twofaEnabledAt: null,
      ...overrides,
    });
  }

  beforeEach(async () => {
    freezeClock(FIXED_NOW);
    directory = createFakeUserDirectory();
    sessionRows = createInMemoryRepository<Session>();

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminProbeController, EnrolmentProbeController],
      providers: [
        SessionService,
        CsrfService,
        SessionResolverService,
        { provide: AUTH_CONFIG, useValue: testAuthConfig() },
        { provide: USER_DIRECTORY, useValue: directory },
        { provide: getRepositoryToken(Session), useValue: sessionRows },
        { provide: SESSION_RESOLVER, useExisting: SessionResolverService },
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      ],
    }).compile();

    sessions = moduleRef.get(SessionService);
    app = await boot(
      // The same two lines `main.ts` uses: Nest's default pair includes
      // `express.urlencoded()`, and `registerBodyParsers` puts back JSON alone.
      moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false }),
    );
  });

  afterEach(async () => {
    await app?.close();
  });

  it('reaches an admin route without ever enrolling', async () => {
    const token = await signIn(admin());

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/consumers')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);

    expect(response.status).toBe(200);
  });

  it.each([
    ['GET', '/api/v1/auth/me'],
    ['POST', '/api/v1/auth/2fa/setup'],
  ])('reaches %s %s, so enrolment stays available to whoever wants it', async (method, path) => {
    const token = await signIn(admin());

    const agent = request(app.getHttpServer());
    const response = await (method === 'GET' ? agent.get(path) : agent.post(path)).set(
      'Cookie',
      `${SESSION_COOKIE}=${token}`,
    );

    expect(response.status).toBe(method === 'GET' ? 200 : 201);
  });

  it('still reaches the admin route once the second factor is enrolled', async () => {
    const user = admin();
    const token = await signIn(user);
    user.twofaEnabledAt = FIXED_NOW;

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/consumers')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);

    expect(response.status).toBe(200);
  });

  it('does not break a public route — a stale-looking cookie resolves to nobody (§2.6)', async () => {
    const token = await signIn(admin());

    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/browse')
      .set('Cookie', `${SESSION_COOKIE}=${token}`);

    expect(response.status).toBe(200);
  });
});
