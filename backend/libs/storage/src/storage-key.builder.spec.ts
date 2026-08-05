/**
 * ARCHITECTURE.md §3.3 — the key layout, and §3.2 requirement 3 — key validation.
 *
 * These tests are the contract for every other module: if a key builder changes shape, the database
 * rows written by the last release stop resolving, so the layout is asserted literally.
 */
import {
  buildTryOnCacheKey,
  extForMimeType,
  isAllowedUploadMimeType,
  isValidStorageKey,
  isValidStoragePrefix,
  keyPrefixSegment,
  MAX_KEY_LENGTH,
  mimeTypeForKey,
  mimeTypesMatch,
  sniffMimeType,
  StorageKeys,
  StoragePrefixes,
} from './storage-key.builder';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const GARMENT_ID = '0f1e2d3c-4b5a-4988-9776-a5b4c3d2e1f0';
const USER_ID = '11111111-2222-4333-8444-555555555555';

describe('StorageKeys (§3.3 key layout)', () => {
  it('builds garments/<garmentId>/<uuid>.<ext>', () => {
    const key = StorageKeys.garmentImage(GARMENT_ID, 'jpg');
    expect(key).toMatch(new RegExp(`^garments/${GARMENT_ID}/${UUID}\\.jpg$`));
  });

  it('builds categories/<categoryId>/<uuid>.<ext>', () => {
    const key = StorageKeys.categoryCover(GARMENT_ID, 'webp');
    expect(key).toMatch(new RegExp(`^categories/${GARMENT_ID}/${UUID}\\.webp$`));
  });

  it('builds person-photos/<userId>/<uuid>.<ext>', () => {
    const key = StorageKeys.personPhoto(USER_ID, 'heic');
    expect(key).toMatch(new RegExp(`^person-photos/${USER_ID}/${UUID}\\.heic$`));
  });

  it('builds renders/<userId>/<uuid>.png — always png', () => {
    const key = StorageKeys.render(USER_ID);
    expect(key).toMatch(new RegExp(`^renders/${USER_ID}/${UUID}\\.png$`));
  });

  it('builds thumbnails/<kind>/<uuid>.webp, and encodes the width as a filename suffix', () => {
    expect(StorageKeys.thumbnail('garment')).toMatch(
      new RegExp(`^thumbnails/garment/${UUID}\\.webp$`),
    );
    expect(StorageKeys.thumbnail('render', 320)).toMatch(
      new RegExp(`^thumbnails/render/${UUID}-320\\.webp$`),
    );
    expect(StorageKeys.thumbnail('person-blurred', 160)).toMatch(
      new RegExp(`^thumbnails/person-blurred/${UUID}-160\\.webp$`),
    );
  });

  it('builds reference-models/<uuid>.jpg and brand/<uuid>.<ext>', () => {
    expect(StorageKeys.referenceModel()).toMatch(new RegExp(`^reference-models/${UUID}\\.jpg$`));
    expect(StorageKeys.brandAsset('svg')).toMatch(new RegExp(`^brand/${UUID}\\.svg$`));
  });

  it('produces a fresh uuid every call — keys are unguessable and never collide', () => {
    const keys = new Set(Array.from({ length: 50 }, () => StorageKeys.render(USER_ID)));
    expect(keys.size).toBe(50);
  });

  it('produces keys that pass the §3.2 requirement 3 validator', () => {
    const keys = [
      StorageKeys.garmentImage(GARMENT_ID, 'jpeg'),
      StorageKeys.categoryCover(GARMENT_ID, 'png'),
      StorageKeys.personPhoto(USER_ID, 'webp'),
      StorageKeys.render(USER_ID),
      StorageKeys.thumbnail('category', 640),
      StorageKeys.referenceModel(),
      StorageKeys.brandAsset('svg'),
    ];
    for (const key of keys) {
      expect(isValidStorageKey(key)).toBe(true);
    }
  });
});

describe('StoragePrefixes', () => {
  it('builds the per-user prefixes a consumer deletion sweeps (§3.3)', () => {
    expect(StoragePrefixes.personPhotosOfUser(USER_ID)).toBe(`person-photos/${USER_ID}/`);
    expect(StoragePrefixes.rendersOfUser(USER_ID)).toBe(`renders/${USER_ID}/`);
  });

  it('produces prefixes that pass validation and keys that do not', () => {
    expect(isValidStoragePrefix(StoragePrefixes.rendersOfUser(USER_ID))).toBe(true);
    expect(isValidStoragePrefix(StorageKeys.render(USER_ID))).toBe(false);
    expect(isValidStorageKey(StoragePrefixes.rendersOfUser(USER_ID))).toBe(false);
  });

  it('reports the leading segment, which selects the §3.4 TTL band', () => {
    expect(keyPrefixSegment(StorageKeys.render(USER_ID))).toBe('renders');
    expect(keyPrefixSegment('brand/x.svg')).toBe('brand');
  });
});

describe('isValidStorageKey (§3.2 requirement 3)', () => {
  it.each([
    ['garments/abc/def.png'],
    ['renders/11111111-2222-4333-8444-555555555555/a1b2.png'],
    ['thumbnails/person-blurred/aa-160.webp'],
    ['brand/logo.svg'],
  ])('accepts %s', (key) => {
    expect(isValidStorageKey(key)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['parent traversal', '../secrets.png'],
    ['embedded traversal', 'garments/../../etc/passwd.png'],
    ['dot segment', 'garments/./a.png'],
    ['leading slash', '/etc/passwd.png'],
    ['double slash', 'garments//a.png'],
    ['windows backslash traversal', '..\\windows\\system32\\config.png'],
    ['windows mixed traversal', 'garments\\..\\..\\secrets.png'],
    ['windows drive letter', 'C:\\Windows\\system32\\drivers\\etc\\hosts.png'],
    ['windows drive relative', 'C:garments/a.png'],
    ['unc share', '\\\\attacker\\share\\payload.png'],
    ['unc long path', '\\\\?\\C:\\payload.png'],
    ['nul byte', 'garments/a\u0000.png'],
    ['nul byte truncation', 'garments/a.png\u0000.txt'],
    ['uppercase', 'Garments/A.PNG'],
    ['no extension', 'garments/a'],
    ['dot directory', '.tmp/a.png'],
    ['meta directory', '.meta/garments/a.png.json'],
    ['url encoded traversal', 'garments/%2e%2e%2fsecrets.png'],
    ['space', 'garments/a b.png'],
    ['query string', 'garments/a.png?x=1'],
  ])('rejects %s', (_label, key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });

  it('rejects a key over the 512 character ceiling', () => {
    const long = `garments/${'a'.repeat(MAX_KEY_LENGTH)}.png`;
    expect(long.length).toBeGreaterThan(MAX_KEY_LENGTH);
    expect(isValidStorageKey(long)).toBe(false);
  });
});

describe('MIME handling (§3.2 requirement 9, PRD A-10)', () => {
  it('allows exactly the PRD A-10 formats', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(isAllowedUploadMimeType(mime)).toBe(true);
    }
    for (const mime of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html']) {
      expect(isAllowedUploadMimeType(mime)).toBe(false);
    }
  });

  it('treats heic and heif as the same container', () => {
    expect(mimeTypesMatch('image/heic', 'image/heif')).toBe(true);
    expect(mimeTypesMatch('image/png', 'image/jpeg')).toBe(false);
  });

  it('ignores charset parameters and casing', () => {
    expect(isAllowedUploadMimeType('IMAGE/JPEG; charset=binary')).toBe(true);
  });

  it('derives the content type from the extension, never from the caller', () => {
    expect(mimeTypeForKey('garments/a/b.webp')).toBe('image/webp');
    expect(mimeTypeForKey('renders/a/b.png')).toBe('image/png');
    expect(mimeTypeForKey('a/b.bin')).toBe('application/octet-stream');
  });

  it('maps an accepted MIME type onto the extension a key is stored under', () => {
    expect(extForMimeType('image/jpeg')).toBe('jpg');
    expect(extForMimeType('image/heif')).toBe('heic');
    expect(extForMimeType('application/zip')).toBeNull();
  });

  it('sniffs the magic bytes of every accepted format', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffMimeType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))).toBe('image/webp');
    expect(sniffMimeType(Buffer.from('\0\0\0\u0018ftypheic\0\0\0\0', 'binary'))).toBe('image/heic');
    expect(sniffMimeType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8'))).toBe(
      'image/svg+xml',
    );
  });

  it('returns null for bytes that are not an accepted image, whatever the client claims', () => {
    expect(sniffMimeType(Buffer.from('GIF89a', 'binary'))).toBeNull();
    expect(sniffMimeType(Buffer.from('%PDF-1.7', 'binary'))).toBeNull();
    expect(sniffMimeType(Buffer.from('<?php echo 1; ?>', 'utf8'))).toBeNull();
  });
});

describe('buildTryOnCacheKey (§3.7)', () => {
  it('is deterministic over the three components', () => {
    expect(buildTryOnCacheKey('g', 'p', '2026-08-01')).toBe(
      buildTryOnCacheKey('g', 'p', '2026-08-01'),
    );
  });

  it('changes when the API version is bumped, invalidating the cache without a migration', () => {
    expect(buildTryOnCacheKey('g', 'p', '2026-08-01')).not.toBe(
      buildTryOnCacheKey('g', 'p', '2026-09-01'),
    );
  });

  it('separates its components, so a:b and ab cannot collide', () => {
    expect(buildTryOnCacheKey('a', 'b', 'v')).not.toBe(buildTryOnCacheKey('ab', '', 'v'));
  });
});
