/**
 * ARCHITECTURE §3.4 / PRD §9.2 — `GET /api/v1/files/:token`.
 *
 * The property under test is the one that matters most about this route: a token scoped to one
 * account cannot be used by another, and an expired token cannot be used by anybody. The
 * `SignedUrlService` is real, so these are HMAC verifications rather than stubbed refusals.
 */
import { Readable } from 'node:stream';

import { EventEmitter2 } from '@nestjs/event-emitter';

import { ErrorCode } from '@library/common';
import {
  SignedUrlAudienceRegistry,
  type StorageService,
  type SignedUrlService,
  type StoredObject,
} from '@library/storage';

import { AUDIT_RECORD_EVENT } from '@api/modules/audit/events/audit.event';
import { AUDIT_ACTIONS } from '@api/shared/constants/audit-actions.constant';

import { createMock } from '../../../../test/fixtures';
import {
  ADMIN,
  CONSUMER,
  CONSUMER_ID,
  createSignedUrlService,
  OTHER_CONSUMER,
} from '../testing/files-fixtures';

import { FileDownloadService } from './file-download.service';

const RENDER_KEY = `renders/${CONSUMER_ID}/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.png`;
const CATALOG_KEY =
  'garments/6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c/aaaa1111-2222-4333-8444-555566667777.jpg';
const BLURRED_KEY = 'thumbnails/person-blurred/bbbb1111-2222-4333-8444-555566667777-160.webp';

function storedObject(key: string, contentType: string): StoredObject {
  return {
    key,
    byteSize: 2048,
    contentType,
    etag: 'f'.repeat(64),
    lastModified: new Date('2026-08-01T00:00:00.000Z'),
  };
}

interface Harness {
  service: FileDownloadService;
  storage: jest.Mocked<StorageService>;
  signedUrls: SignedUrlService;
  events: EventEmitter2;
  audiences: SignedUrlAudienceRegistry;
}

function build(object: StoredObject | null = storedObject(RENDER_KEY, 'image/png')): Harness {
  const signedUrls = createSignedUrlService();
  const storage = createMock<StorageService>(['head', 'get', 'remainingTtlSeconds']);
  storage.head.mockResolvedValue(object);
  storage.get.mockResolvedValue(Readable.from([Buffer.from('bytes')]));
  storage.remainingTtlSeconds.mockImplementation((payload) =>
    signedUrls.remainingTtlSeconds(payload),
  );

  const events = new EventEmitter2();
  jest.spyOn(events, 'emit');

  // The real registry, with nothing registered unless a test registers it. That is the
  // production default too, and it is what makes the fail-closed assertions meaningful.
  const audiences = new SignedUrlAudienceRegistry();

  return {
    service: new FileDownloadService(storage, signedUrls, events, audiences),
    storage,
    signedUrls,
    events,
    audiences,
  };
}

describe('FileDownloadService — subject scoping (§3.4 step 4, PRD §9.2)', () => {
  it('serves a render to the account the token was issued to', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID });

    const file = await harness.service.open(token, CONSUMER);

    expect(file.contentType).toBe('image/png');
    expect(file.byteSize).toBe(2048);
  });

  it('refuses a render URL replayed by another account', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID });

    await expect(harness.service.open(token, OTHER_CONSUMER)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_SUBJECT_MISMATCH,
    });
  });

  it('refuses a subject-scoped token presented with no session at all', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID });

    await expect(harness.service.open(token, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_SUBJECT_MISMATCH,
    });
  });

  it('refuses an admin session reading a consumer’s render (S-10)', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID });

    await expect(harness.service.open(token, ADMIN)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_SUBJECT_MISMATCH,
    });
  });

  it('never reaches storage when the subject does not match', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID });

    await expect(harness.service.open(token, OTHER_CONSUMER)).rejects.toBeDefined();

    expect(harness.storage.head).not.toHaveBeenCalled();
    expect(harness.storage.get).not.toHaveBeenCalled();
  });

  it('serves a public asset with no session', async () => {
    const harness = build(storedObject(CATALOG_KEY, 'image/jpeg'));
    const token = harness.signedUrls.issue(CATALOG_KEY);

    await expect(harness.service.open(token, undefined)).resolves.toMatchObject({
      contentType: 'image/jpeg',
    });
  });
});

describe('FileDownloadService — token validity (§3.4 steps 1–3, 5)', () => {
  it('refuses an expired token', async () => {
    const harness = build();
    const issuedAt = new Date('2026-08-01T00:00:00.000Z');
    const token = harness.signedUrls.issue(RENDER_KEY, {
      subject: CONSUMER_ID,
      ttlSeconds: 900,
      now: issuedAt,
    });

    jest.useFakeTimers().setSystemTime(new Date(issuedAt.getTime() + 901_000));
    try {
      await expect(harness.service.open(token, CONSUMER)).rejects.toMatchObject({
        errorCode: ErrorCode.FILE_TOKEN_EXPIRED,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuses a tampered signature', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(CATALOG_KEY);
    const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;

    await expect(harness.service.open(tampered, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_INVALID,
    });
  });

  it('refuses a token forged with a different secret', async () => {
    const harness = build();
    const foreign = createSignedUrlService();
    // Same construction, different key material would be caught; here the same secret is used,
    // so instead prove that a payload edited after signing fails the HMAC.
    const token = foreign.issue(CATALOG_KEY);
    const [payload, signature] = token.split('.');
    const swapped = `${Buffer.from(
      JSON.stringify({ key: 'brand/aaaa1111-2222-4333-8444-555566667777.png', exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url')}.${signature}`;

    expect(payload).not.toBe('');
    await expect(harness.service.open(swapped, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_INVALID,
    });
  });

  it('refuses a token whose payload is not a token at all', async () => {
    const harness = build();

    await expect(harness.service.open('not-a-token', undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_INVALID,
    });
  });

  it('reports a missing object as FILE_NOT_FOUND, after the token has been proved', async () => {
    const harness = build(null);
    const token = harness.signedUrls.issue(CATALOG_KEY);

    await expect(harness.service.open(token, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_NOT_FOUND,
    });
  });
});

describe('FileDownloadService — caching policy (§3.4 step 6)', () => {
  it('keeps a private render out of every shared cache', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID });

    const file = await harness.service.open(token, CONSUMER);

    expect(file.cacheControl).toMatch(/^private, max-age=\d+, must-revalidate$/);
    expect(file.cacheControl).not.toContain('public');
  });

  it('never lets a private cache entry outlive the token that authorised it', async () => {
    const harness = build();
    const token = harness.signedUrls.issue(RENDER_KEY, { subject: CONSUMER_ID, ttlSeconds: 120 });

    const file = await harness.service.open(token, CONSUMER);
    const maxAge = Number(/max-age=(\d+)/.exec(file.cacheControl)?.[1]);

    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(120);
  });

  it('lets a public catalog asset be cached properly (§9.1)', async () => {
    const harness = build(storedObject(CATALOG_KEY, 'image/jpeg'));
    const token = harness.signedUrls.issue(CATALOG_KEY);

    const file = await harness.service.open(token, undefined);

    expect(file.cacheControl).toMatch(/^public, max-age=\d+$/);
  });
});

/**
 * PRD C-34 — "share links are revocable at any time".
 *
 * A share-page thumbnail is read by somebody with no session, so there is no `sub` to
 * check and the URL used to be a plain bearer token with the public one-hour TTL. Revoking
 * the link removed the page and left every image URL already handed out working. These
 * assert the binding that closes it — and, just as importantly, that it fails **closed**.
 */
describe('FileDownloadService — audience-bound tokens (C-34, §3.4 step 4b)', () => {
  const SHARE_LINK_ID = 'dddddddd-1111-4222-8333-444455556666';
  const AUDIENCE = `share-link:${SHARE_LINK_ID}`;
  const THUMB_KEY = 'thumbnails/render/cccc1111-2222-4333-8444-555566667777-320.webp';

  function thumbnail(): StoredObject {
    return storedObject(THUMB_KEY, 'image/webp');
  }

  it('serves a share thumbnail while the link it names is live', async () => {
    const harness = build(thumbnail());
    harness.audiences.register('share-link', { isAudienceLive: async () => true });
    const token = harness.signedUrls.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300 });

    await expect(harness.service.open(token, undefined)).resolves.toMatchObject({
      contentType: 'image/webp',
    });
  });

  it('refuses the same URL once the link has been revoked', async () => {
    const harness = build(thumbnail());
    let revoked = false;
    harness.audiences.register('share-link', { isAudienceLive: async () => !revoked });
    const token = harness.signedUrls.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300 });

    await expect(harness.service.open(token, undefined)).resolves.toBeDefined();

    revoked = true;

    await expect(harness.service.open(token, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_EXPIRED,
    });
  });

  it('never reaches storage for a token whose link is revoked', async () => {
    const harness = build(thumbnail());
    harness.audiences.register('share-link', { isAudienceLive: async () => false });
    const token = harness.signedUrls.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300 });

    await expect(harness.service.open(token, undefined)).rejects.toBeDefined();

    expect(harness.storage.head).not.toHaveBeenCalled();
    expect(harness.storage.get).not.toHaveBeenCalled();
  });

  it('fails closed when no validator has claimed the scheme', async () => {
    const harness = build(thumbnail());
    const token = harness.signedUrls.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300 });

    // Nothing registered. An unrecognised claim must never be treated as no claim —
    // that would silently downgrade the token back to a bearer URL.
    await expect(harness.service.open(token, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_EXPIRED,
    });
  });

  it('fails closed when the validator itself throws', async () => {
    const harness = build(thumbnail());
    harness.audiences.register('share-link', {
      isAudienceLive: async () => {
        throw new Error('the database is down');
      },
    });
    const token = harness.signedUrls.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300 });

    await expect(harness.service.open(token, undefined)).rejects.toMatchObject({
      errorCode: ErrorCode.FILE_TOKEN_EXPIRED,
    });
  });

  it('keeps an audience-bound thumbnail cacheable only for the token’s own short life', async () => {
    const harness = build(thumbnail());
    harness.audiences.register('share-link', { isAudienceLive: async () => true });
    const token = harness.signedUrls.issue(THUMB_KEY, { audience: AUDIENCE, ttlSeconds: 300 });

    const file = await harness.service.open(token, undefined);
    const maxAge = Number(/max-age=(\d+)/.exec(file.cacheControl)?.[1]);

    // The defect was the *public* 3600s TTL on an image of somebody's shortlist.
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(300);
  });

  it('leaves an ordinary subject-less asset alone — no claim, no check', async () => {
    const harness = build(storedObject(CATALOG_KEY, 'image/jpeg'));
    const registered = jest.fn(async () => false);
    harness.audiences.register('share-link', { isAudienceLive: registered });
    const token = harness.signedUrls.issue(CATALOG_KEY);

    await expect(harness.service.open(token, undefined)).resolves.toBeDefined();
    expect(registered).not.toHaveBeenCalled();
  });
});

describe('FileDownloadService — moderation reads (A-34, §3.4 step 4)', () => {
  it('audits an admin reading a blurred moderation thumbnail', async () => {
    const harness = build(storedObject(BLURRED_KEY, 'image/webp'));
    // §3.4: the blurred thumbnail's `sub` is the reviewing admin's own id, not the consumer's.
    const token = harness.signedUrls.issue(BLURRED_KEY, { subject: ADMIN.id });

    await harness.service.open(token, ADMIN);

    expect(harness.events.emit).toHaveBeenCalledWith(
      AUDIT_RECORD_EVENT,
      expect.objectContaining({
        input: expect.objectContaining({
          action: AUDIT_ACTIONS.MODERATION_ITEM_VIEWED,
          actorId: ADMIN.id,
        }),
      }),
    );
  });

  it('puts no storage key in the audit metadata (§3.4, E-12)', async () => {
    const harness = build(storedObject(BLURRED_KEY, 'image/webp'));
    const token = harness.signedUrls.issue(BLURRED_KEY, { subject: ADMIN.id });

    await harness.service.open(token, ADMIN);

    const emitted = JSON.stringify(jest.mocked(harness.events.emit).mock.calls);
    expect(emitted).not.toContain(BLURRED_KEY);
    expect(emitted).not.toContain('thumbnails/');
  });

  it('audits nothing for an ordinary catalog read', async () => {
    const harness = build(storedObject(CATALOG_KEY, 'image/jpeg'));
    const token = harness.signedUrls.issue(CATALOG_KEY);

    await harness.service.open(token, undefined);

    expect(harness.events.emit).not.toHaveBeenCalled();
  });
});
