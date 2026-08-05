/**
 * ARCHITECTURE.md §3.2 requirement 1 and §7.
 *
 * The boot assertion is the one that keeps consumer photos out of the working tree, so it is tested
 * against the real repository as well as against an injected root.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { StorageConfigError } from './exceptions/storage.exception';
import {
  assertRootOutsideRepository,
  findRepositoryRoot,
  isPathInside,
  loadStorageConfig,
} from './storage.config';

const SECRET = 'a'.repeat(64);

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    STORAGE_URL_SECRET: SECRET,
    APP_API_URL: 'http://localhost:4000',
    ...overrides,
  };
}

describe('loadStorageConfig', () => {
  let outsideRoot: string;

  beforeAll(async () => {
    outsideRoot = await mkdtemp(join(tmpdir(), 'drape-storage-config-'));
  });

  afterAll(async () => {
    await rm(outsideRoot, { recursive: true, force: true });
  });

  describe('the storage-root-inside-repo boot assertion', () => {
    it('throws when STORAGE_ROOT is inside the real repository', () => {
      const repositoryRoot = findRepositoryRoot(__dirname);
      expect(repositoryRoot).not.toBeNull();

      expect(() =>
        loadStorageConfig(envWith({ STORAGE_ROOT: join(repositoryRoot as string, 'storage') })),
      ).toThrow(StorageConfigError);
    });

    it('throws when STORAGE_ROOT is the library folder itself', () => {
      expect(() => loadStorageConfig(envWith({ STORAGE_ROOT: __dirname }))).toThrow(
        StorageConfigError,
      );
    });

    it('throws when STORAGE_ROOT is the repository root', () => {
      const repositoryRoot = resolve('/repo');
      expect(() => assertRootOutsideRepository(repositoryRoot, [repositoryRoot])).toThrow(
        StorageConfigError,
      );
    });

    it('throws when STORAGE_ROOT is nested deep inside the repository', () => {
      const repositoryRoot = resolve('/repo');
      expect(() =>
        assertRootOutsideRepository(join(repositoryRoot, 'backend', 'libs', 'storage'), [
          repositoryRoot,
        ]),
      ).toThrow(StorageConfigError);
    });

    it('throws when the root would contain the repository', () => {
      const repositoryRoot = resolve('/srv/app/repo');
      expect(() => assertRootOutsideRepository(resolve('/srv/app'), [repositoryRoot])).toThrow(
        StorageConfigError,
      );
    });

    it('throws when STORAGE_ROOT is relative', () => {
      expect(() => assertRootOutsideRepository('storage', [resolve('/repo')])).toThrow(
        StorageConfigError,
      );
    });

    it('accepts a sibling of the repository whose name shares a prefix', () => {
      expect(() =>
        assertRootOutsideRepository(resolve('/srv/repo-storage'), [resolve('/srv/repo')]),
      ).not.toThrow();
    });

    it('accepts a root outside the repository', () => {
      expect(loadStorageConfig(envWith({ STORAGE_ROOT: outsideRoot })).root).toBe(
        resolve(outsideRoot),
      );
    });

    it('names STORAGE_ROOT and the reason in the boot failure', () => {
      const repositoryRoot = findRepositoryRoot(__dirname) as string;
      expect(() =>
        loadStorageConfig(envWith({ STORAGE_ROOT: join(repositoryRoot, 'uploads') })),
      ).toThrow(/STORAGE_ROOT resolves inside the repository/);
    });
  });

  describe('required variables (no secret has a fallback default)', () => {
    it('fails when STORAGE_ROOT is missing — there is no in-repo default to fall back on', () => {
      expect(() => loadStorageConfig(envWith({ STORAGE_ROOT: undefined }))).toThrow(
        /STORAGE_ROOT is required/,
      );
    });

    it('fails when STORAGE_URL_SECRET is missing', () => {
      expect(() =>
        loadStorageConfig({ STORAGE_ROOT: outsideRoot, APP_API_URL: 'http://localhost:4000' }),
      ).toThrow(/STORAGE_URL_SECRET is required/);
    });

    it('fails when STORAGE_URL_SECRET is too short to be a real key', () => {
      expect(() =>
        loadStorageConfig(envWith({ STORAGE_ROOT: outsideRoot, STORAGE_URL_SECRET: 'short' })),
      ).toThrow(/at least 32 characters/);
    });

    it('fails when APP_API_URL is missing', () => {
      expect(() =>
        loadStorageConfig({ STORAGE_ROOT: outsideRoot, STORAGE_URL_SECRET: SECRET }),
      ).toThrow(/APP_API_URL is required/);
    });

    it('treats whitespace as missing', () => {
      expect(() => loadStorageConfig(envWith({ STORAGE_ROOT: '   ' }))).toThrow(
        /STORAGE_ROOT is required/,
      );
    });
  });

  describe('defaults and parsing (§7)', () => {
    it('applies the §7 defaults for every optional variable', () => {
      const config = loadStorageConfig(envWith({ STORAGE_ROOT: outsideRoot }));

      expect(config.driver).toBe('local');
      expect(config.photoUrlTtlSeconds).toBe(300);
      expect(config.renderUrlTtlSeconds).toBe(900);
      expect(config.publicUrlTtlSeconds).toBe(3600);
      expect(config.uploadTicketTtlSeconds).toBe(900);
      expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
      expect(config.minFreeBytes).toBe(2048 * 1024 * 1024);
    });

    it('reads overrides and strips the trailing slash from APP_API_URL', () => {
      const config = loadStorageConfig(
        envWith({
          STORAGE_ROOT: outsideRoot,
          APP_API_URL: 'https://api.example.com/',
          STORAGE_DRIVER: 's3',
          STORAGE_URL_TTL_RENDER_SECONDS: '1200',
          STORAGE_MAX_UPLOAD_MB: '10',
        }),
      );

      expect(config.apiBaseUrl).toBe('https://api.example.com');
      expect(config.driver).toBe('s3');
      expect(config.renderUrlTtlSeconds).toBe(1200);
      expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
    });

    it('rejects a nonsense driver and a nonsense number', () => {
      expect(() =>
        loadStorageConfig(envWith({ STORAGE_ROOT: outsideRoot, STORAGE_DRIVER: 'ftp' })),
      ).toThrow(StorageConfigError);
      expect(() =>
        loadStorageConfig(envWith({ STORAGE_ROOT: outsideRoot, STORAGE_MAX_UPLOAD_MB: '-1' })),
      ).toThrow(StorageConfigError);
      expect(() =>
        loadStorageConfig(envWith({ STORAGE_ROOT: outsideRoot, STORAGE_MAX_UPLOAD_MB: 'lots' })),
      ).toThrow(StorageConfigError);
    });
  });
});

describe('isPathInside', () => {
  it('treats a directory as inside itself', () => {
    expect(isPathInside(resolve('/a/b'), resolve('/a/b'))).toBe(true);
  });

  it('compares whole segments, not string prefixes', () => {
    expect(isPathInside(resolve('/a/bc'), resolve('/a/b'))).toBe(false);
    expect(isPathInside(resolve(`/a/b${sep}c`), resolve('/a/b'))).toBe(true);
  });

  it('is false for an unrelated path', () => {
    expect(isPathInside(resolve('/x'), resolve('/a/b'))).toBe(false);
  });
});
