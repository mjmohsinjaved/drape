import { VersioningType, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

import cookieParser from 'cookie-parser';
import request from 'supertest';

import {
  CsrfGuard,
  CustomValidationPipe,
  ErrorCode,
  GlobalExceptionFilter,
  RolesGuard,
} from '@library/common';

import { registerBodyParsers } from '@api/bootstrap/body-parser.config';
import { AUTH_CONFIG } from '@api/modules/auth/auth.constants';
import { AuthController } from '@api/modules/auth/controllers/auth.controller';
import { AuthService } from '@api/modules/auth/services/auth.service';
import { CsrfService } from '@api/modules/auth/services/csrf.service';
import { SessionService } from '@api/modules/auth/services/session.service';
import { testAuthConfig } from '@api/modules/auth/testing/auth-fixtures';

import { freezeClock, FIXED_NOW } from '../setup/time';

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
        body: { user: null },
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
