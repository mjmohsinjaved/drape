/**
 * ARCHITECTURE.md §3.4 (signed download URLs) and §3.5 (upload tickets).
 *
 * The subject-mismatch case is the one that matters most: PRD §9.2 requires that a render URL
 * issued to one account cannot be replayed by another.
 */
import { createHmac } from 'node:crypto';

import { SignedUrlService, URL_EXPIRY_BUCKET_SECONDS } from './signed-url.service';

import type { StorageConfig } from './storage.config';

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);

const OWNER = '11111111-2222-4333-8444-555555555555';
const ATTACKER = '99999999-8888-4777-8666-555555555555';

const PHOTO_KEY = `person-photos/${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg`;
const RENDER_KEY = `renders/${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.png`;
const BLURRED_KEY = 'thumbnails/person-blurred/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-160.webp';
const PUBLIC_KEY =
  'garments/0f1e2d3c-4b5a-4988-9776-a5b4c3d2e1f0/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff.jpg';

function configWith(secret: string): StorageConfig {
  return {
    driver: 'local',
    root: '/nowhere-this-suite-never-touches-disk',
    urlSecret: secret,
    apiBaseUrl: 'http://localhost:4000',
    photoUrlTtlSeconds: 300,
    renderUrlTtlSeconds: 900,
    publicUrlTtlSeconds: 3600,
    uploadTicketTtlSeconds: 900,
    maxUploadBytes: 25 * 1024 * 1024,
    minFreeBytes: 0,
  };
}

function errorCodeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    return typeof code === 'string' ? code : `<${String(error)}>`;
  }
  return '<no error thrown>';
}

describe('SignedUrlService', () => {
  const service = new SignedUrlService(configWith(SECRET));
  const now = new Date('2026-08-04T12:00:00.000Z');

  describe('§3.4 issuing rules', () => {
    it('requires a subject for person photos, renders and blurred moderation thumbnails', () => {
      expect(service.subjectRequiredForKey(PHOTO_KEY)).toBe(true);
      expect(service.subjectRequiredForKey(RENDER_KEY)).toBe(true);
      expect(service.subjectRequiredForKey(BLURRED_KEY)).toBe(true);
    });

    it('omits the subject for public assets', () => {
      expect(service.subjectRequiredForKey(PUBLIC_KEY)).toBe(false);
      expect(service.subjectRequiredForKey('brand/aaaa.svg')).toBe(false);
      expect(service.subjectRequiredForKey('thumbnails/garment/aaaa-320.webp')).toBe(false);
    });

    it('applies the TTL of the object class', () => {
      expect(service.ttlSecondsForKey(PHOTO_KEY)).toBe(300);
      expect(service.ttlSecondsForKey(RENDER_KEY)).toBe(900);
      expect(service.ttlSecondsForKey(BLURRED_KEY)).toBe(300);
      expect(service.ttlSecondsForKey(PUBLIC_KEY)).toBe(3600);
    });

    it('refuses to issue a subject-less token for a private object', () => {
      expect(errorCodeOf(() => service.issue(RENDER_KEY))).toBe('FILE_TOKEN_SUBJECT_MISMATCH');
    });

    it('builds the §3.4 URL shape', () => {
      const url = service.issueUrl(PUBLIC_KEY, { now });
      expect(url.startsWith('http://localhost:4000/api/v1/files/')).toBe(true);
      expect(url).not.toContain(PUBLIC_KEY);
    });
  });

  describe('sign → verify round trip', () => {
    it('returns the payload for a public token', () => {
      const token = service.issue(PUBLIC_KEY, { now });
      expect(service.verify(token, { now })).toEqual({
        key: PUBLIC_KEY,
        exp: Math.floor(now.getTime() / 1000) + 3600,
      });
    });

    it('returns the payload for a private token read by its owner', () => {
      const token = service.issue(RENDER_KEY, { subject: OWNER, now });
      expect(service.verify(token, { subject: OWNER, now })).toEqual({
        key: RENDER_KEY,
        exp: Math.floor(now.getTime() / 1000) + 900,
        sub: OWNER,
      });
    });

    it('reports the remaining TTL for the Cache-Control header (§3.4 step 6)', () => {
      const token = service.issue(PUBLIC_KEY, { now });
      const payload = service.verify(token, { now });
      const halfway = new Date(now.getTime() + 1800_000);
      expect(service.remainingTtlSeconds(payload, halfway)).toBe(1800);
    });

    it('produces a token in the base64url(payload).base64url(signature) shape', () => {
      const token = service.issue(PUBLIC_KEY, { now });
      const parts = token.split('.');
      expect(parts).toHaveLength(2);
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const payload: unknown = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      expect(Object.keys(payload as Record<string, unknown>)).toEqual(['key', 'exp']);
    });

    it('orders the payload keys key, exp, sub as §3.4 specifies', () => {
      const token = service.issue(RENDER_KEY, { subject: OWNER, now });
      const payload: unknown = JSON.parse(
        Buffer.from(token.split('.')[0], 'base64url').toString('utf8'),
      );
      expect(Object.keys(payload as Record<string, unknown>)).toEqual(['key', 'exp', 'sub']);
    });
  });

  describe('rejection paths, in the §3.4 order', () => {
    it('rejects a malformed token', () => {
      for (const token of ['', '.', 'no-separator', 'abc.', '.abc']) {
        expect(errorCodeOf(() => service.verify(token, { now }))).toBe('FILE_TOKEN_INVALID');
      }
    });

    it('rejects a tampered signature', () => {
      const token = service.issue(PUBLIC_KEY, { now });
      const [payload, signature] = token.split('.');
      const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
      expect(errorCodeOf(() => service.verify(`${payload}.${flipped}`, { now }))).toBe(
        'FILE_TOKEN_INVALID',
      );
    });

    it('rejects a tampered payload — the signature no longer covers it', () => {
      const token = service.issue(RENDER_KEY, { subject: OWNER, now });
      const signature = token.split('.')[1];
      const swapped = Buffer.from(
        JSON.stringify({ key: RENDER_KEY, exp: 9_999_999_999, sub: ATTACKER }),
        'utf8',
      ).toString('base64url');
      expect(errorCodeOf(() => service.verify(`${swapped}.${signature}`, { now }))).toBe(
        'FILE_TOKEN_INVALID',
      );
    });

    it('rejects a token signed with a different secret', () => {
      const foreign = new SignedUrlService(configWith(OTHER_SECRET));
      const token = foreign.issue(PUBLIC_KEY, { now });
      expect(errorCodeOf(() => service.verify(token, { now }))).toBe('FILE_TOKEN_INVALID');
    });

    it('rejects an expired token', () => {
      const token = service.issue(PHOTO_KEY, { subject: OWNER, now });
      const later = new Date(now.getTime() + 301_000);
      expect(errorCodeOf(() => service.verify(token, { subject: OWNER, now: later }))).toBe(
        'FILE_TOKEN_EXPIRED',
      );
    });

    it('checks the signature before the expiry, so an expired forgery reads as invalid', () => {
      const foreign = new SignedUrlService(configWith(OTHER_SECRET));
      const token = foreign.issue(PHOTO_KEY, { subject: OWNER, now });
      const later = new Date(now.getTime() + 301_000);
      expect(errorCodeOf(() => service.verify(token, { subject: OWNER, now: later }))).toBe(
        'FILE_TOKEN_INVALID',
      );
    });

    it('rejects a render URL replayed by another account (PRD §9.2)', () => {
      const token = service.issue(RENDER_KEY, { subject: OWNER, now });
      expect(errorCodeOf(() => service.verify(token, { subject: ATTACKER, now }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });

    it('rejects a private token presented with no session at all', () => {
      const token = service.issue(PHOTO_KEY, { subject: OWNER, now });
      expect(errorCodeOf(() => service.verify(token, { now }))).toBe('FILE_TOKEN_SUBJECT_MISMATCH');
    });

    it('accepts a blurred moderation thumbnail read by the admin it was issued to (A-34)', () => {
      const adminId = 'aaaaaaaa-1111-4222-8333-444444444444';
      const token = service.issue(BLURRED_KEY, { subject: adminId, now });
      expect(service.verify(token, { subject: adminId, now }).sub).toBe(adminId);
      expect(errorCodeOf(() => service.verify(token, { subject: ATTACKER, now }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });

    it('rejects a valid signature over a payload whose key is not a legal storage key', () => {
      const forged = service.sign({ key: '../../etc/passwd', exp: 9_999_999_999 });
      expect(errorCodeOf(() => service.verify(forged, { now }))).toBe('FILE_TOKEN_INVALID');
    });
  });

  describe('the expiry bucket — a signed URL has to be cacheable (PRD §9.1)', () => {
    it('produces an identical token for two calls inside one bucket', () => {
      // Same bytes, same URL, so the browser, a CDN and Next's image optimiser — whose cache
      // key is the URL — can all reuse what they already have.
      const early = new Date(now.getTime() + 1_000);
      const late = new Date(now.getTime() + (URL_EXPIRY_BUCKET_SECONDS - 1) * 1_000);

      expect(service.issue(RENDER_KEY, { subject: OWNER, now: late })).toBe(
        service.issue(RENDER_KEY, { subject: OWNER, now: early }),
      );
      expect(service.issueUrl(PUBLIC_KEY, { now: late })).toBe(
        service.issueUrl(PUBLIC_KEY, { now: early }),
      );
    });

    it('produces a different token once the bucket boundary is crossed', () => {
      const inside = new Date(now.getTime() + (URL_EXPIRY_BUCKET_SECONDS - 1) * 1_000);
      const across = new Date(now.getTime() + URL_EXPIRY_BUCKET_SECONDS * 1_000);

      expect(service.issue(RENDER_KEY, { subject: OWNER, now: across })).not.toBe(
        service.issue(RENDER_KEY, { subject: OWNER, now: inside }),
      );
    });

    it('still scopes the token to its subject', () => {
      const token = service.issue(RENDER_KEY, { subject: OWNER, now });

      expect(errorCodeOf(() => service.verify(token, { subject: ATTACKER, now }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });

    it('never extends a token past the §3.4 TTL for its class', () => {
      // Rounding the *issue instant* down can only shorten a life, never lengthen one. A photo
      // URL that outlived its 300 s would be a security change dressed up as a cache fix.
      for (let offset = 0; offset < URL_EXPIRY_BUCKET_SECONDS; offset += 7) {
        const at = new Date(now.getTime() + offset * 1_000);
        const payload = service.verify(service.issue(PHOTO_KEY, { subject: OWNER, now: at }), {
          subject: OWNER,
          now: at,
        });
        const remaining = service.remainingTtlSeconds(payload, at);

        expect(remaining).toBeLessThanOrEqual(300);
        expect(remaining).toBeGreaterThan(300 - URL_EXPIRY_BUCKET_SECONDS);
      }
    });

    it('still expires — the bucket moves the clock, not the contract', () => {
      const token = service.issue(PHOTO_KEY, { subject: OWNER, now });
      const past = new Date(now.getTime() + 301_000);

      expect(errorCodeOf(() => service.verify(token, { subject: OWNER, now: past }))).toBe(
        'FILE_TOKEN_EXPIRED',
      );
    });

    it('leaves upload tickets exact — nothing caches a one-shot ticket', () => {
      const base = {
        contentType: 'image/jpeg',
        maxBytes: 5_000_000,
        ttlSeconds: 900,
        subject: OWNER,
      };
      const later = new Date(now.getTime() + 1_000);

      expect(service.issueUploadTicket(PHOTO_KEY, { ...base, now: later }).payload.exp).toBe(
        Math.floor(later.getTime() / 1000) + 900,
      );
    });
  });

  describe('upload tickets (§3.5)', () => {
    const ticketOptions = {
      contentType: 'image/jpeg',
      maxBytes: 5_000_000,
      ttlSeconds: 900,
      subject: OWNER,
      now,
    };

    it('round trips the extra payload', () => {
      const { token } = service.issueUploadTicket(PHOTO_KEY, ticketOptions);
      expect(service.verifyUploadTicket(token, { subject: OWNER, now })).toEqual({
        key: PHOTO_KEY,
        exp: Math.floor(now.getTime() / 1000) + 900,
        sub: OWNER,
        maxBytes: 5_000_000,
        contentType: 'image/jpeg',
      });
    });

    it('builds the local upload URL', () => {
      const { token } = service.issueUploadTicket(PHOTO_KEY, ticketOptions);
      expect(service.buildUploadUrl(token)).toBe(
        `http://localhost:4000/api/v1/files/upload/${token}`,
      );
    });

    it('rejects an expired ticket', () => {
      const { token } = service.issueUploadTicket(PHOTO_KEY, ticketOptions);
      const later = new Date(now.getTime() + 901_000);
      expect(
        errorCodeOf(() => service.verifyUploadTicket(token, { subject: OWNER, now: later })),
      ).toBe('UPLOAD_TICKET_EXPIRED');
    });

    it('rejects a ticket redeemed by another account', () => {
      const { token } = service.issueUploadTicket(PHOTO_KEY, ticketOptions);
      expect(errorCodeOf(() => service.verifyUploadTicket(token, { subject: ATTACKER, now }))).toBe(
        'UPLOAD_TICKET_INVALID',
      );
    });

    it('will not accept a download token as an upload ticket — the domain separator differs', () => {
      const download = service.issue(PHOTO_KEY, { subject: OWNER, now });
      expect(errorCodeOf(() => service.verifyUploadTicket(download, { subject: OWNER, now }))).toBe(
        'UPLOAD_TICKET_INVALID',
      );
    });

    it('will not accept an upload ticket as a download token', () => {
      const { token } = service.issueUploadTicket(PHOTO_KEY, ticketOptions);
      expect(errorCodeOf(() => service.verify(token, { subject: OWNER, now }))).toBe(
        'FILE_TOKEN_INVALID',
      );
    });

    /**
     * `''` is not a subject.
     *
     * `POST /files/upload/:token` is a `@Public()` route, so a caller with no session
     * reaches `verifyUploadTicket` with `subject` resolved from nothing. A ticket whose
     * `sub` were `''` would compare **equal** to that and be redeemable by anybody.
     * Unreachable today because every call site passes a session id — but the local
     * driver used to default `subject` to `''`, which is precisely how it would have
     * become reachable.
     */
    it('refuses to mint a ticket with an empty subject', () => {
      expect(
        errorCodeOf(() => service.issueUploadTicket(PHOTO_KEY, { ...ticketOptions, subject: '' })),
      ).toBe('UPLOAD_TICKET_INVALID');
    });

    it('refuses a ticket whose sub is empty, however it was minted', () => {
      // Forged with this service's own secret, so only the emptiness is under test.
      const encoded = Buffer.from(
        JSON.stringify({
          key: PHOTO_KEY,
          exp: Math.floor(now.getTime() / 1000) + 900,
          sub: '',
          maxBytes: 1024,
          contentType: 'image/jpeg',
        }),
        'utf8',
      ).toString('base64url');
      const forged = `${encoded}.${signUploadPayload(SECRET, encoded)}`;

      expect(errorCodeOf(() => service.verifyUploadTicket(forged, { subject: '', now }))).toBe(
        'UPLOAD_TICKET_INVALID',
      );
    });
  });

  /**
   * ARCHITECTURE §3.4 — `exports/**`.
   *
   * The single caller passes a subject, so nothing leaked. But `subjectRequiredForKey` is
   * the guard whose entire job is to make forgetting impossible, and it did not cover the
   * class: `issue('exports/…')` with no subject minted a session-less bearer URL to an
   * archive holding up to five hundred full-resolution renders of one consumer's body —
   * on the *public* 3600-second TTL, four times the render TTL.
   */
  describe('export archives are a private object class (§3.4)', () => {
    const EXPORT_KEY = `exports/${OWNER}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.zip`;

    it('requires a subject', () => {
      expect(service.subjectRequiredForKey(EXPORT_KEY)).toBe(true);
      expect(errorCodeOf(() => service.issue(EXPORT_KEY))).toBe('FILE_TOKEN_SUBJECT_MISMATCH');
    });

    it('takes the render TTL, not the public one — an archive is a container of renders', () => {
      expect(service.ttlSecondsForKey(EXPORT_KEY)).toBe(900);
    });

    it('cannot be replayed by another account', () => {
      const token = service.issue(EXPORT_KEY, { subject: OWNER, now });
      expect(errorCodeOf(() => service.verify(token, { subject: ATTACKER, now }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });
  });

  /**
   * An empty `sub` is a token scoped to nobody that still *looks* scoped: `payload.sub
   * !== undefined` is true for `''`, so verification compares it against a session id and
   * refuses everybody — or, on a `@Public()` route where no session resolves, matches.
   * Neither is an outcome any caller wants, so it is refused at issue.
   */
  describe('an empty subject or audience is never a credential', () => {
    it('refuses an empty subject on a public key', () => {
      expect(errorCodeOf(() => service.issue(PUBLIC_KEY, { subject: '' }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });

    it('refuses an empty subject on a private key', () => {
      expect(errorCodeOf(() => service.issue(RENDER_KEY, { subject: '' }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });

    it('refuses an empty audience', () => {
      expect(errorCodeOf(() => service.issue(PUBLIC_KEY, { audience: '' }))).toBe(
        'FILE_TOKEN_SUBJECT_MISMATCH',
      );
    });
  });

  /** C-34 — the claim that lets a revoked share link stop the images it handed out. */
  describe('the audience claim (C-34)', () => {
    const THUMB_KEY = 'thumbnails/render/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-320.webp';
    const AUDIENCE = 'share-link:0f1e2d3c-4b5a-4988-9776-a5b4c3d2e1f0';

    it('round-trips through sign and verify, unmodified', () => {
      const token = service.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300, now });
      expect(service.verify(token, { now })).toEqual({
        key: THUMB_KEY,
        exp: Math.floor(now.getTime() / 1000) + 300,
        aud: AUDIENCE,
      });
    });

    it('is covered by the HMAC, so it cannot be swapped for another link', () => {
      const token = service.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300, now });
      const [, signature] = token.split('.');
      const swapped = Buffer.from(
        JSON.stringify({
          key: THUMB_KEY,
          exp: Math.floor(now.getTime() / 1000) + 300,
          aud: 'share-link:ffffffff-ffff-4fff-8fff-ffffffffffff',
        }),
        'utf8',
      ).toString('base64url');

      expect(errorCodeOf(() => service.verify(`${swapped}.${signature ?? ''}`, { now }))).toBe(
        'FILE_TOKEN_INVALID',
      );
    });

    it('still yields a stable URL inside one expiry bucket, so caching survives', () => {
      const first = service.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300, now });
      const second = service.issue(THUMB_KEY, {
        audience: AUDIENCE,
        ttlSeconds: 300,
        now: new Date(now.getTime() + 30_000),
      });
      expect(first).toBe(second);
    });
  });
});

/** Reproduces the `"upload:"`-domain signature, so a forged ticket can be built in a test. */
function signUploadPayload(secret: string, encodedPayload: string): string {
  return createHmac('sha256', secret).update(`upload:${encodedPayload}`).digest('base64url');
}
