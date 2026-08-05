/**
 * PRD C-39 — the export archive.
 *
 * `archiver` is not a dependency of this project and was not added for this. That is
 * only defensible if what this writes is a **real** ZIP, so this file reads the bytes
 * back and checks them against the format: the three signatures, the CRC-32 per entry,
 * the central directory offsets, and the entry count in the EOCD record.
 *
 * If any of these drift, an unzip tool reports a corrupt archive and a consumer
 * concludes her data is gone. A test that only asserted "a Buffer came back" would pass
 * on a file nothing could open.
 */
import { buildZipArchive, crc32, normaliseEntryName, toDosDateTime } from './zip-archive';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

const MANIFEST = Buffer.from('{"exportedAt":"2026-08-15T12:00:00.000Z"}', 'utf8');
const RENDER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
const MODIFIED_AT = new Date('2026-08-15T12:34:56.000Z');

/** Reads the EOCD record from the end of an archive. It is the last 22 bytes. */
function readEocd(archive: Buffer): {
  entries: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
} {
  const start = archive.byteLength - 22;
  expect(archive.readUInt32LE(start)).toBe(END_OF_CENTRAL_DIRECTORY);

  return {
    entries: archive.readUInt16LE(start + 10),
    centralDirectorySize: archive.readUInt32LE(start + 12),
    centralDirectoryOffset: archive.readUInt32LE(start + 16),
  };
}

describe('buildZipArchive', () => {
  const archive = buildZipArchive([
    { name: 'manifest.json', data: MANIFEST, modifiedAt: MODIFIED_AT },
    { name: 'renders/anarkali-in-ivory-1.png', data: RENDER, modifiedAt: MODIFIED_AT },
  ]);

  it('starts with a local file header signature — it is a ZIP, not a renamed tarball', () => {
    expect(archive.readUInt32LE(0)).toBe(LOCAL_FILE_HEADER);
  });

  it('ends with an end-of-central-directory record naming every entry', () => {
    const eocd = readEocd(archive);
    expect(eocd.entries).toBe(2);
    expect(eocd.centralDirectorySize).toBeGreaterThan(0);
  });

  it('places the central directory where the EOCD says it is', () => {
    const eocd = readEocd(archive);
    expect(archive.readUInt32LE(eocd.centralDirectoryOffset)).toBe(CENTRAL_DIRECTORY_HEADER);
    expect(eocd.centralDirectoryOffset + eocd.centralDirectorySize + 22).toBe(archive.byteLength);
  });

  it('writes the first entry with the right name, sizes and CRC', () => {
    expect(archive.readUInt16LE(8)).toBe(0); // stored, method 0
    expect(archive.readUInt32LE(14)).toBe(crc32(MANIFEST));
    expect(archive.readUInt32LE(18)).toBe(MANIFEST.byteLength); // compressed
    expect(archive.readUInt32LE(22)).toBe(MANIFEST.byteLength); // uncompressed

    const nameLength = archive.readUInt16LE(26);
    expect(archive.subarray(30, 30 + nameLength).toString('utf8')).toBe('manifest.json');
  });

  it('stores the bytes verbatim, so an unzip tool recovers exactly what went in', () => {
    const nameLength = archive.readUInt16LE(26);
    const dataStart = 30 + nameLength;
    expect(archive.subarray(dataStart, dataStart + MANIFEST.byteLength)).toEqual(MANIFEST);
  });

  it('flags UTF-8 names, so a garment title with an accent survives the round trip', () => {
    // Bit 11 of the general-purpose flags.
    expect(archive.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });

  it('produces a valid empty archive — an account with nothing in it is not an error', () => {
    const empty = buildZipArchive([]);

    expect(empty.byteLength).toBe(22);
    expect(readEocd(empty).entries).toBe(0);
  });

  it('refuses an entry name that would escape the archive when unpacked', () => {
    expect(() => buildZipArchive([{ name: '../../etc/passwd', data: MANIFEST }])).toThrow();
    expect(() => normaliseEntryName('a/../../b.txt')).toThrow();
    expect(normaliseEntryName('/renders/a.png')).toBe('renders/a.png');
    expect(normaliseEntryName('renders\\a.png')).toBe('renders/a.png');
  });
});

describe('crc32', () => {
  it('matches the known CRC-32 of "123456789" — the standard check value', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926);
  });

  it('is zero for no bytes', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });
});

describe('toDosDateTime', () => {
  it('encodes a date the way ZIP has since 1989', () => {
    const { time, date } = toDosDateTime(new Date(2026, 7, 15, 12, 34, 56));

    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(8);
    expect(date & 0x1f).toBe(15);
    expect(time >> 11).toBe(12);
    expect((time >> 5) & 0x3f).toBe(34);
    // Two seconds of resolution — 56 is stored as 28.
    expect((time & 0x1f) * 2).toBe(56);
  });

  it('clamps a pre-1980 date rather than wrapping it into the twenty-second century', () => {
    const { date } = toDosDateTime(new Date(1970, 0, 1));
    expect((date >> 9) + 1980).toBe(1980);
  });
});
