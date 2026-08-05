import { EventEmitter2 } from '@nestjs/event-emitter';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ErrorCode,
  Locale,
  Role,
  UserStatus,
  httpStatusForErrorCode,
  maskErrorCode,
  type ICurrentUser,
} from '@library/common';
import { ImageService, StorageService } from '@library/storage';

import { Garment } from '@api/modules/garments/entities/garment.entity';
import { SettingsService } from '@api/modules/settings';
import { ShortlistItem } from '@api/modules/shortlist/entities/shortlist-item.entity';
import { ShortlistService } from '@api/modules/shortlist/services/shortlist.service';
import { SETTINGS_KEYS } from '@api/shared/constants/settings-keys.constant';

import { buildTryOnResult } from '../../../../test/factories';
import { createMock, createTestingModule, type TestHarness } from '../../../../test/fixtures';
import { MAX_DOWNLOAD_RESULTS, ResultDownloadDto } from '../dto/result-download.dto';
import { TryOnResult } from '../entities/tryon-result.entity';

import { ResultDownloadService } from './result-download.service';
import { ResultsService } from './results.service';

import type { Readable } from 'node:stream';

/**
 * `POST /results/download` — the watermarked zip. ARCHITECTURE §5.12, PRD C-23, C-39.
 *
 * This route takes a **selection**, and a selection is exactly where a batch ownership
 * check goes wrong. The failure mode worth the most here is not an exception that never
 * fires — it is a `200` carrying three of her renders and nothing at all to say the fourth
 * id was somebody else's. So the properties asserted are, in order of how much they cost
 * when they break:
 *
 *  1. **ownership is decided per item, before the archive exists.** A selection mixing her
 *     ids with a foreign one fails whole; no byte of hers is read, marked or streamed.
 *  2. **the refusal discloses nothing.** A foreign id and a made-up id are answered
 *     identically once §2.4's mask is applied — the response is never an oracle for which
 *     render ids exist (§9.2, S-9).
 *  3. **every entry carries the C-23 mark.** The stored render is clean by design (§3.6),
 *     so this path is the only one that composites it and the stored file must never reach
 *     the client.
 *  4. **the archive streams.** Peak memory is one render, not twenty-five, and bytes reach
 *     the client while later entries are still being marked.
 */

const OWNER: ICurrentUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: Role.CONSUMER,
  email: 'owner@example.invalid',
  name: 'Owner',
  status: UserStatus.ACTIVE,
  emailVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  phoneVerifiedAt: null,
  sessionId: '77777777-7777-4777-8777-777777777777',
  locale: Locale.EN,
};

const INTRUDER: ICurrentUser = { ...OWNER, id: '22222222-2222-4222-8222-222222222222' };

const BRAND_NAME = 'Drape Studio';

/* ---------------------------------------------------------------------------------------------
 * A minimal ZIP reader
 *
 * There is no unzip dependency in this project and adding one to read four entries would be a
 * production dependency bought for a test. The archive is written with `store: true`, so an
 * entry's bytes are its bytes: the central directory at the end of the file gives the name, the
 * size and the local-header offset, and the data begins straight after that local header. Sizes
 * are read from the central directory rather than the local header because a streamed entry
 * carries them in a trailing data descriptor.
 * ------------------------------------------------------------------------------------------ */

interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

function readZip(archive: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error('The archive has no end-of-central-directory record — it is not a zip.');
  }

  const total = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < total; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new Error(`The central directory is malformed at entry ${index}.`);
    }

    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error(`Entry "${name}" does not point at a local file header.`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;

    entries.push({ name, bytes: archive.subarray(dataStart, dataStart + compressedSize) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

/* ---------------------------------------------------------------------------------------------
 * Harness
 * ------------------------------------------------------------------------------------------ */

/** The clean, stored render. The archive must never contain these bytes. */
function cleanBytesFor(key: string): Buffer {
  return Buffer.from(`clean:${key}`, 'utf8');
}

/** What the C-23 mark turns them into. Distinguishable from the clean bytes on sight. */
function markedBytesFor(key: string, text: string, direction: string): Buffer {
  return Buffer.from(`MARKED[${direction}|${text}]:${key}`, 'utf8');
}

interface Harness {
  service: ResultDownloadService;
  storage: jest.Mocked<Pick<StorageService, 'getBuffer' | 'signedUrl' | 'delete'>>;
  images: jest.Mocked<Pick<ImageService, 'watermark'>>;
  settings: jest.Mocked<Pick<SettingsService, 'getString'>>;
  harness: TestHarness;
  /** Highest number of renders being marked at once. §5.12: it must never exceed one. */
  peakConcurrentMarks: () => number;
  /** Resolves the deferred mark for a storage key, if one was armed. */
  release: (key: string) => void;
}

interface BuildOptions {
  readonly rows?: readonly TryOnResult[];
  readonly brandLogoKey?: string | null;
  /** Storage keys whose watermark hangs until `release()` is called. */
  readonly gate?: readonly string[];
}

async function build(options: BuildOptions = {}): Promise<Harness> {
  const storage = createMock<Pick<StorageService, 'getBuffer' | 'signedUrl' | 'delete'>>([
    'getBuffer',
    'signedUrl',
    'delete',
  ]);
  storage.getBuffer.mockImplementation(async (key: string) => cleanBytesFor(key));
  storage.signedUrl.mockImplementation((key: string) => `https://api.test/${key}`);
  storage.delete.mockResolvedValue(true);

  const gates = new Map<string, () => void>();
  const pending = new Map<string, Promise<void>>();
  for (const key of options.gate ?? []) {
    pending.set(key, new Promise<void>((resolve) => gates.set(key, resolve)));
  }

  let inFlight = 0;
  let peak = 0;

  const images = createMock<Pick<ImageService, 'watermark'>>(['watermark']);
  images.watermark.mockImplementation(async (clean: Buffer, watermarkOptions = {}) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      const key = clean.toString('utf8').replace(/^clean:/, '');
      const held = pending.get(key);
      if (held !== undefined) {
        await held;
      }
      return markedBytesFor(key, watermarkOptions.text ?? '', watermarkOptions.direction ?? 'ltr');
    } finally {
      inFlight -= 1;
    }
  });

  const settings = createMock<Pick<SettingsService, 'getString'>>(['getString']);
  settings.getString.mockImplementation(async (key: string) => {
    if (key === SETTINGS_KEYS.BRAND_NAME) {
      return BRAND_NAME;
    }
    if (key === SETTINGS_KEYS.BRAND_LOGO_KEY) {
      return options.brandLogoKey ?? null;
    }
    return null;
  });

  const testHarness = await createTestingModule({
    // `ResultsService` is the real thing: `loadOwnedMany()` is the predicate under test
    // here, and a mocked one would assert nothing at all.
    providers: [ResultDownloadService, ResultsService],
    repositories: [
      { entity: TryOnResult, rows: options.rows ?? [] },
      { entity: Garment },
      { entity: ShortlistItem },
    ],
    overrides: [
      { token: StorageService, value: storage },
      { token: ImageService, value: images },
      { token: SettingsService, value: settings },
      { token: EventEmitter2, value: new EventEmitter2() },
      { token: ShortlistService, value: createMock<ShortlistService>(['recordVerdict']) },
    ],
  });

  return {
    service: testHarness.get<ResultDownloadService>(ResultDownloadService),
    storage,
    images,
    settings,
    harness: testHarness,
    peakConcurrentMarks: (): number => peak,
    release: (key: string): void => gates.get(key)?.(),
  };
}

/** Three of her renders, with titles that make the entry names readable. */
function herRenders(): TryOnResult[] {
  return [
    buildTryOnResult({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: OWNER.id,
      storageKey: 'renders/owner/one.png',
      garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
    }),
    buildTryOnResult({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      userId: OWNER.id,
      storageKey: 'renders/owner/two.png',
      garmentTitleSnapshot: 'Emerald Anarkali',
    }),
    buildTryOnResult({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      userId: OWNER.id,
      storageKey: 'renders/owner/three.png',
      garmentTitleSnapshot: 'Ivory Sharara',
    }),
  ];
}

describe('ResultDownloadService.downloadMany — the archive contains exactly what she asked for', () => {
  let harness: TestHarness;

  afterEach(async () => {
    await harness.close();
  });

  it('archives exactly the requested renders — not everything she owns', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany(OWNER, [rows[0].id, rows[2].id]);
    const entries = readZip(await drain(archive.stream));

    expect(archive.entryCount).toBe(2);
    expect(entries.map((entry) => entry.name)).toEqual([
      'zarrin-bridal-lehenga-aaaaaaaa.png',
      'ivory-sharara-cccccccc.png',
    ]);
    // The one she left out was never read.
    expect(built.storage.getBuffer).not.toHaveBeenCalledWith(rows[1].storageKey);
  });

  it('watermarks every entry, and the stored file never reaches the client (C-23, §3.6)', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany(OWNER, [rows[0].id, rows[1].id]);
    const entries = readZip(await drain(archive.stream));

    expect(entries[0]?.bytes).toEqual(markedBytesFor(rows[0].storageKey, BRAND_NAME, 'ltr'));
    expect(entries[1]?.bytes).toEqual(markedBytesFor(rows[1].storageKey, BRAND_NAME, 'ltr'));
    expect(built.images.watermark).toHaveBeenCalledTimes(2);

    // The clean bytes are what the mark was composited *onto*; they must not be the
    // archive's contents. §3.6 keeps the stored render clean, which is only safe as long
    // as this path is the only one that hands bytes out.
    for (const entry of entries) {
      expect(entry.bytes.toString('utf8')).not.toBe(cleanBytesFor(rows[0].storageKey).toString());
      expect(entry.bytes.toString('utf8').startsWith('MARKED[')).toBe(true);
    }
  });

  it('applies the same mark a single download would (§5.12 — one render or twenty-five)', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const single = await built.service.download(OWNER, rows[0].id);
    const archive = await built.service.downloadMany(OWNER, [rows[0].id]);
    const [entry] = readZip(await drain(archive.stream));

    expect(entry?.bytes).toEqual(single.bytes);
    expect(entry?.name).toBe(single.filename);
  });

  it('follows her locale for the mark’s direction (D-10, §3.6 bottom-inline-end)', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany({ ...OWNER, locale: Locale.UR }, [rows[0].id]);
    const [entry] = readZip(await drain(archive.stream));

    expect(entry?.bytes).toEqual(markedBytesFor(rows[0].storageKey, BRAND_NAME, 'rtl'));
  });

  it('keeps two renders of the same piece apart inside the archive', async () => {
    const rows = [
      buildTryOnResult({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        userId: OWNER.id,
        storageKey: 'renders/owner/first.png',
        garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
      }),
      buildTryOnResult({
        id: 'dddddddd-dddd-4ddd-8ddd-eeeeeeeeeeee',
        userId: OWNER.id,
        storageKey: 'renders/owner/second.png',
        garmentTitleSnapshot: 'Zarrin Bridal Lehenga',
      }),
    ];
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany(OWNER, [rows[0].id, rows[1].id]);
    const entries = readZip(await drain(archive.stream));

    expect(new Set(entries.map((entry) => entry.name)).size).toBe(2);
    expect(entries[0]?.bytes).not.toEqual(entries[1]?.bytes);
  });

  it('names the download as an attachment, not as JSON', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany(OWNER, [rows[0].id, rows[1].id]);
    await drain(archive.stream);

    expect(archive.contentType).toBe('application/zip');
    expect(archive.filename).toBe('drape-studio-renders-2.zip');
  });

  it('degrades to the text mark when the brand asset cannot be read — she asked for her render', async () => {
    const rows = herRenders();
    const built = await build({ rows, brandLogoKey: 'brand/logo.png' });
    harness = built.harness;
    built.storage.getBuffer.mockImplementation(async (key: string) => {
      if (key === 'brand/logo.png') {
        throw new Error('the asset is gone');
      }
      return cleanBytesFor(key);
    });

    const archive = await built.service.downloadMany(OWNER, [rows[0].id]);
    const entries = readZip(await drain(archive.stream));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.bytes).toEqual(markedBytesFor(rows[0].storageKey, BRAND_NAME, 'ltr'));
  });
});

describe('ResultDownloadService.downloadMany — ownership is decided per item (§9.2, S-9)', () => {
  let harness: TestHarness;

  afterEach(async () => {
    await harness.close();
  });

  it('refuses a selection mixing her renders with somebody else’s', async () => {
    const rows = herRenders();
    const foreign = buildTryOnResult({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: INTRUDER.id,
    });
    const built = await build({ rows: [...rows, foreign] });
    harness = built.harness;

    await expect(
      built.service.downloadMany(OWNER, [rows[0].id, foreign.id, rows[1].id]),
    ).rejects.toMatchObject({ errorCode: ErrorCode.RESULT_NOT_OWNED });
  });

  it('never produces the partial archive — no byte of hers is read, marked or streamed', async () => {
    const rows = herRenders();
    const foreign = buildTryOnResult({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: INTRUDER.id,
    });
    const built = await build({ rows: [...rows, foreign] });
    harness = built.harness;

    // Hers first in the list, deliberately: an implementation that checked as it appended
    // would already have marked and queued this one before it reached the foreign id.
    await expect(
      built.service.downloadMany(OWNER, [rows[0].id, rows[1].id, foreign.id]),
    ).rejects.toBeDefined();

    // Once the first byte of a `200` has left there is no status code left to refuse with,
    // so the whole ownership pass must complete before the archive exists.
    expect(built.storage.getBuffer).not.toHaveBeenCalled();
    expect(built.images.watermark).not.toHaveBeenCalled();
  });

  it('refuses a selection of one foreign id even when every other id is hers', async () => {
    const rows = herRenders();
    const foreign = buildTryOnResult({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: INTRUDER.id,
    });
    const built = await build({ rows: [...rows, foreign] });
    harness = built.harness;

    // Filtering by `userId` and zipping whatever came back would return three renders and
    // a `200` here — a silent partial success dressed as a complete one.
    await expect(
      built.service.downloadMany(OWNER, [rows[0].id, rows[1].id, rows[2].id, foreign.id]),
    ).rejects.toBeDefined();
  });

  it('answers a foreign id exactly as it answers one that does not exist (§2.4, §9.2)', async () => {
    const rows = herRenders();
    const foreign = buildTryOnResult({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: INTRUDER.id,
    });
    const built = await build({ rows: [...rows, foreign] });
    harness = built.harness;

    const refusalFor = async (id: string): Promise<{ code: ErrorCode; status: number }> => {
      try {
        await built.service.downloadMany(OWNER, [rows[0].id, id]);
      } catch (error: unknown) {
        const code = (error as { errorCode: ErrorCode }).errorCode;
        // §2.4: `GlobalExceptionFilter` logs the true code and returns the masked one.
        // What a client can observe is the pair below, and nothing else.
        return { code: maskErrorCode(code), status: httpStatusForErrorCode(maskErrorCode(code)) };
      }
      throw new Error(`"${id}" was not refused at all.`);
    };

    const somebodyElses = await refusalFor(foreign.id);
    const madeUp = await refusalFor('99999999-9999-4999-8999-999999999999');

    expect(somebodyElses).toEqual(madeUp);
    expect(somebodyElses.code).toBe(ErrorCode.RESULT_NOT_FOUND);
    expect(somebodyElses.status).toBe(404);
  });

  it('logs the true code even though it returns the masked one, so an admin can still see it', async () => {
    const rows = herRenders();
    const foreign = buildTryOnResult({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      userId: INTRUDER.id,
    });
    const built = await build({ rows: [...rows, foreign] });
    harness = built.harness;

    await expect(built.service.downloadMany(OWNER, [foreign.id])).rejects.toMatchObject({
      errorCode: ErrorCode.RESULT_NOT_OWNED,
    });
    // The two halves of §2.4: a distinct true code, and a mask that erases the distinction.
    expect(maskErrorCode(ErrorCode.RESULT_NOT_OWNED)).toBe(ErrorCode.RESULT_NOT_FOUND);
  });

  it('refuses a soft-deleted render of hers rather than resurrecting it (C-31)', async () => {
    const rows = herRenders();
    const deleted = buildTryOnResult({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      userId: OWNER.id,
      deletedAt: new Date('2026-08-02T00:00:00.000Z'),
    });
    const built = await build({ rows: [...rows, deleted] });
    harness = built.harness;

    await expect(built.service.downloadMany(OWNER, [rows[0].id, deleted.id])).rejects.toMatchObject(
      { errorCode: ErrorCode.RESULT_NOT_FOUND },
    );
    expect(built.images.watermark).not.toHaveBeenCalled();
  });
});

describe('ResultDownloadService.downloadMany — the archive streams (§5.12)', () => {
  let harness: TestHarness;

  afterEach(async () => {
    await harness.close();
  });

  it('does not materialise the archive before returning it', async () => {
    const rows = herRenders();
    // The last entry hangs. If the service assembled the archive first, the call below
    // could not resolve at all.
    const built = await build({ rows, gate: [rows[2].storageKey] });
    harness = built.harness;

    const archive = await built.service.downloadMany(OWNER, [rows[0].id, rows[1].id, rows[2].id]);

    expect(archive.entryCount).toBe(3);
    expect(archive.stream.readableEnded).toBe(false);

    // Bytes are already flowing while the third render is still being marked.
    const chunks: Buffer[] = [];
    const gotSomething = new Promise<void>((resolve) => {
      archive.stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        resolve();
      });
    });
    await gotSomething;

    expect(Buffer.concat(chunks).length).toBeGreaterThan(0);
    expect(built.images.watermark).toHaveBeenCalled();
    // Still open: the third render has not been marked, so an implementation that
    // assembled the whole archive first could not have produced these bytes.
    expect(archive.stream.readableEnded).toBe(false);

    built.release(rows[2].storageKey);
    const whole = Buffer.concat([Buffer.concat(chunks), await drain(archive.stream)]);
    expect(readZip(whole)).toHaveLength(3);
  });

  it('holds one render in memory at a time, whatever the size of the selection', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany(OWNER, [rows[0].id, rows[1].id, rows[2].id]);
    await drain(archive.stream);

    // Peak memory for a twenty-five render download is therefore one render.
    expect(built.peakConcurrentMarks()).toBe(1);
  });

  it('produces a real zip that any tool can open, entry by entry', async () => {
    const rows = herRenders();
    const built = await build({ rows });
    harness = built.harness;

    const archive = await built.service.downloadMany(
      OWNER,
      rows.map((row) => row.id),
    );
    const entries = readZip(await drain(archive.stream));

    expect(entries).toHaveLength(3);
    for (const [index, entry] of entries.entries()) {
      // Stored, not deflated — a PNG is already deflate-compressed. The bytes in the
      // archive are the bytes that went in.
      expect(entry.bytes).toEqual(markedBytesFor(rows[index].storageKey, BRAND_NAME, 'ltr'));
    }
  });
});

/**
 * The selection bounds — §2.8, C-5.
 *
 * Enforced by the DTO because that is where a malformed body is refused before a handler
 * ever runs. An unbounded list is a request to watermark the catalogue; an empty one is a
 * zip with nothing in it, which is a `200` that helps nobody.
 */
describe('ResultDownloadDto — the selection is bounded, non-empty and unique', () => {
  async function errorsFor(resultIds: unknown): Promise<string[]> {
    const dto = plainToInstance(ResultDownloadDto, { resultIds });
    const errors = await validate(dto);
    return errors.flatMap((error) => Object.keys(error.constraints ?? {}));
  }

  function ids(count: number): string[] {
    return Array.from(
      { length: count },
      (_unused, index) => `00000000-0000-4000-8000-${`${index}`.padStart(12, '0')}`,
    );
  }

  it('accepts a selection inside the ceiling', async () => {
    expect(await errorsFor(ids(MAX_DOWNLOAD_RESULTS))).toEqual([]);
  });

  it('refuses an empty selection', async () => {
    expect(await errorsFor([])).toContain('arrayNotEmpty');
  });

  it('refuses a selection past the ceiling rather than truncating it', async () => {
    expect(await errorsFor(ids(MAX_DOWNLOAD_RESULTS + 1))).toContain('arrayMaxSize');
    // C-5 gives her fifteen generations a month, so a larger selection is not a
    // selection — it is "everything", and C-39's account export is what that is for.
    expect(MAX_DOWNLOAD_RESULTS).toBe(25);
  });

  it('refuses a repeated id, so one render cannot be billed to the archive twice', async () => {
    const [first] = ids(1);
    expect(await errorsFor([first, first])).toContain('arrayUnique');
  });

  it('refuses anything that is not a uuid', async () => {
    expect(await errorsFor(['not-a-uuid'])).toContain('isUuid');
  });

  it('refuses a body that is not a list at all', async () => {
    expect(await errorsFor('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toContain('isArray');
  });
});
