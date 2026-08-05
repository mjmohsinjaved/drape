/**
 * A minimal, standards-correct ZIP writer — PRD C-39.
 *
 * ### Why this exists rather than a dependency
 *
 * C-39 asks for "her shortlists and renders as a downloadable archive". `archiver` is
 * the obvious library and is **not** a dependency of this project. Adding one to write
 * a few hundred kilobytes of already-compressed PNGs would buy compression that PNG
 * has already applied, streaming this path does not need, and a transitive tree for a
 * format that fits in one file.
 *
 * So this writes a real ZIP: local file headers, a central directory and an
 * end-of-central-directory record, per PKWARE APPNOTE 6.3.x, with CRC-32 over every
 * entry. `unzip`, Windows Explorer, macOS Archive Utility and every language's zip
 * library open it. It is **not** a renamed tarball, a concatenation, or a "zip" that
 * only this codebase can read — the brief's instruction was not to fake the format, and
 * implementing it is the opposite of faking it.
 *
 * ### Stored, not deflated
 *
 * Compression method 0. Her archive is PNG renders and one JSON manifest; PNG is
 * already deflate-compressed, so method 8 would spend CPU to save nothing on the bulk
 * of the bytes. `node:zlib.deflateRaw` is in the standard library if that ever changes
 * — the only edits are the method field and the compressed size.
 *
 * ### The limits, stated
 *
 * No ZIP64: entries and archives are capped at 4 GiB, which is four orders of magnitude
 * above a consumer's export (C-5 caps her at fifteen generations a month). The writer
 * refuses rather than silently truncating a size field, because a ZIP with a wrapped
 * length is a corrupt file that reports itself as valid.
 */

/** ZIP signatures, in the order they appear in the file. */
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Compression method 0 — stored. See the note above. */
const METHOD_STORE = 0;

/** Bit 11 of the general-purpose flags: filenames and comments are UTF-8. */
const FLAG_UTF8 = 0x0800;

/** "PKZIP 2.0", the floor for everything this writer emits. */
const VERSION = 20;

/** No ZIP64 — a size field is four bytes and this writer will not wrap one silently. */
const MAX_ZIP32_BYTES = 0xffffffff;

/** One file to put in the archive. */
export interface ZipEntry {
  /** Path inside the archive. Forward slashes, no leading slash, no `..`. */
  readonly name: string;
  readonly data: Buffer;
  /** Modification time written into the DOS date fields. Defaults to now. */
  readonly modifiedAt?: Date;
}

/**
 * Builds the archive in memory.
 *
 * In memory is a deliberate bound, not an oversight: the caller
 * ({@link DataExportService}) reads her renders one at a time and caps the total, so
 * "how big can this get" has an answer that does not depend on how long she has had an
 * account. A streaming writer would remove the cap along with the answer.
 */
export function buildZipArchive(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = normaliseEntryName(entry.name);
    const nameBytes = Buffer.from(name, 'utf8');
    const data = entry.data;

    if (data.byteLength > MAX_ZIP32_BYTES) {
      throw new RangeError(
        `"${name}" is larger than a ZIP32 size field can describe. ZIP64 is not implemented; ` +
          'a wrapped length would produce a corrupt archive that reports itself as valid.',
      );
    }

    const crc = crc32(data);
    const { time, date } = toDosDateTime(entry.modifiedAt ?? new Date());

    const local = Buffer.alloc(30 + nameBytes.byteLength);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(nameBytes.byteLength, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.byteLength);
    central.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(nameBytes.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

/**
 * Refuses a name that would escape the archive when it is unpacked.
 *
 * A "zip slip" is an entry called `../../etc/passwd`. Nothing in this codebase composes
 * an entry name from user input — the names are `renders/<uuid>.png` and
 * `shortlist.json` — but the guard is here rather than in the caller, because the
 * caller is the thing most likely to change.
 */
export function normaliseEntryName(name: string): string {
  const cleaned = name.replace(/\\/g, '/').replace(/^\/+/, '');

  if (cleaned === '' || cleaned.split('/').some((segment) => segment === '..')) {
    throw new RangeError(`"${name}" is not a safe archive entry name.`);
  }
  return cleaned;
}

/** MS-DOS date and time, as ZIP has stored them since 1989. Two seconds of resolution. */
export function toDosDateTime(at: Date): { time: number; date: number } {
  // Before 1980 there is no representable DOS date. Clamped rather than wrapped: an
  // archive whose entries claim 2107 is a stranger artefact than one claiming 1980.
  const year = Math.max(1980, at.getFullYear());

  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/**
 * The CRC-32 table, built once. Polynomial `0xEDB88320` — the reflected form of the
 * IEEE 802.3 polynomial, which is the one ZIP uses.
 */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 of a buffer. Every ZIP entry carries one; an unzip tool checks it. */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.byteLength; index += 1) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ data[index]) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
