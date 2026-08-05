/**
 * ARCHITECTURE §3.5 step 1 / PRD §9.2 — issuing an upload ticket.
 *
 * A ticket is a write capability. What is tested here is who may obtain one, what it may point
 * at, and how much it may admit — in particular that a client cannot choose the prefix, cannot
 * choose the filename, and cannot raise its own ceiling.
 */
import { ErrorCode } from '@library/common';
import { type StorageService, type UploadTicket } from '@library/storage';

import { createMock } from '../../../../test/fixtures';
import { UPLOAD_PURPOSE_POLICIES } from '../constants/upload-purposes.constant';
import { UploadPurpose } from '../enums/upload-purpose.enum';
import {
  ADMIN,
  ADMIN_ID,
  CONSUMER,
  CONSUMER_ID,
  GARMENT_ID,
  OTHER_CONSUMER_ID,
} from '../testing/files-fixtures';

import { UploadTicketService } from './upload-ticket.service';

import type { CreateUploadTicketDto } from '../dto/create-upload-ticket.dto';

const MEGABYTE = 1024 * 1024;

interface Harness {
  service: UploadTicketService;
  storage: jest.Mocked<StorageService>;
}

function build(): Harness {
  const storage = createMock<StorageService>(['createUploadTicket']);
  storage.createUploadTicket.mockImplementation((request) =>
    Promise.resolve<UploadTicket>({
      uploadUrl: `https://api.test/api/v1/files/upload/token-for-${request.key}`,
      key: request.key,
      fields: {},
      expiresAt: new Date('2026-08-05T10:00:00.000Z'),
      isDirect: false,
    }),
  );

  return { service: new UploadTicketService(storage), storage };
}

function request(overrides: Partial<CreateUploadTicketDto> = {}): CreateUploadTicketDto {
  return {
    purpose: UploadPurpose.PERSON_PHOTO,
    contentType: 'image/jpeg',
    byteSize: 2 * MEGABYTE,
    ...overrides,
  };
}

describe('UploadTicketService — purpose authorisation (§3.5 step 1)', () => {
  it('lets a consumer request a person-photo ticket', async () => {
    const { service } = build();

    const ticket = await service.issue(request(), CONSUMER);

    expect(ticket.purpose).toBe(UploadPurpose.PERSON_PHOTO);
    expect(ticket.key.startsWith(`person-photos/${CONSUMER_ID}/`)).toBe(true);
  });

  it('refuses a consumer asking for a garment-image ticket', async () => {
    const { service, storage } = build();

    await expect(
      service.issue(
        request({ purpose: UploadPurpose.GARMENT_IMAGE, ownerId: GARMENT_ID }),
        CONSUMER,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INSUFFICIENT_ROLE });

    expect(storage.createUploadTicket).not.toHaveBeenCalled();
  });

  it('refuses an admin asking for a person-photo ticket (S-10)', async () => {
    const { service } = build();

    await expect(service.issue(request(), ADMIN)).rejects.toMatchObject({
      errorCode: ErrorCode.INSUFFICIENT_ROLE,
    });
  });

  it.each([
    [UploadPurpose.GARMENT_IMAGE, GARMENT_ID],
    [UploadPurpose.CATEGORY_COVER, GARMENT_ID],
    [UploadPurpose.BRAND_ASSET, undefined],
  ])('lets an admin request a %s ticket', async (purpose, ownerId) => {
    const { service } = build();

    const ticket = await service.issue(request({ purpose, ownerId }), ADMIN);

    expect(ticket.purpose).toBe(purpose);
  });
});

describe('UploadTicketService — the key is built, never accepted (§3.3)', () => {
  it('files a person photo under the caller’s own id, whatever ownerId said', async () => {
    const { service } = build();

    // A consumer naming somebody else's id. The server ignores it entirely (PRD §9.2).
    const ticket = await service.issue(request({ ownerId: OTHER_CONSUMER_ID }), CONSUMER);

    expect(ticket.key.startsWith(`person-photos/${CONSUMER_ID}/`)).toBe(true);
    expect(ticket.key).not.toContain(OTHER_CONSUMER_ID);
  });

  it('files a garment image under the named garment', async () => {
    const { service } = build();

    const ticket = await service.issue(
      request({ purpose: UploadPurpose.GARMENT_IMAGE, ownerId: GARMENT_ID }),
      ADMIN,
    );

    expect(ticket.key.startsWith(`garments/${GARMENT_ID}/`)).toBe(true);
  });

  it('derives the extension from the declared type, so there is no filename to sanitise', async () => {
    const { service } = build();

    for (const [contentType, ext] of [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['image/heic', 'heic'],
    ]) {
      const ticket = await service.issue(request({ contentType }), CONSUMER);
      expect(ticket.key.endsWith(`.${ext}`)).toBe(true);
    }
  });

  it('produces a fresh, unguessable key every time', async () => {
    const { service } = build();

    const first = await service.issue(request(), CONSUMER);
    const second = await service.issue(request(), CONSUMER);

    expect(first.key).not.toBe(second.key);
  });

  it('refuses a content type outside the purpose’s allow-list', async () => {
    const { service } = build();

    await expect(
      service.issue(request({ contentType: 'image/svg+xml' }), CONSUMER),
    ).rejects.toMatchObject({ errorCode: ErrorCode.IMAGE_FORMAT_UNSUPPORTED });
  });

  it('requires an owner for a garment or category upload', async () => {
    const { service } = build();

    await expect(
      service.issue(request({ purpose: UploadPurpose.GARMENT_IMAGE }), ADMIN),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_ERROR,
      errors: [expect.objectContaining({ field: 'ownerId' })],
    });
  });
});

describe('UploadTicketService — ceilings and scoping (§3.5)', () => {
  it('scopes the ticket to the requesting account', async () => {
    const { service, storage } = build();

    await service.issue(request(), CONSUMER);

    expect(storage.createUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({ subject: CONSUMER_ID }),
    );
  });

  it('issues a ceiling no larger than the purpose allows, whatever was asked for', async () => {
    const { service } = build();
    const purposeCeiling = UPLOAD_PURPOSE_POLICIES[UploadPurpose.PERSON_PHOTO].maxBytes;

    const ticket = await service.issue(request({ byteSize: 500 * MEGABYTE }), CONSUMER);

    expect(ticket.maxBytes).toBe(purposeCeiling);
  });

  it('issues a ceiling no larger than the file the client says it has', async () => {
    const { service } = build();

    const ticket = await service.issue(request({ byteSize: 300_000 }), CONSUMER);

    expect(ticket.maxBytes).toBe(300_000);
  });

  it('gives a brand asset the tightest ceiling of the four', async () => {
    const { service } = build();

    const ticket = await service.issue(
      request({ purpose: UploadPurpose.BRAND_ASSET, byteSize: 500 * MEGABYTE }),
      ADMIN,
    );

    expect(ticket.maxBytes).toBe(UPLOAD_PURPOSE_POLICIES[UploadPurpose.BRAND_ASSET].maxBytes);
    expect(ticket.maxBytes).toBeLessThan(
      UPLOAD_PURPOSE_POLICIES[UploadPurpose.GARMENT_IMAGE].maxBytes,
    );
  });

  it('reports the ticket the driver produced, including whether the API is in the data path', async () => {
    const { service } = build();

    const ticket = await service.issue(request({ purpose: UploadPurpose.BRAND_ASSET }), {
      ...ADMIN,
      id: ADMIN_ID,
    });

    expect(ticket.isDirect).toBe(false);
    expect(ticket.uploadUrl).toContain('/api/v1/files/upload/');
    expect(ticket.fields).toEqual({});
  });
});
