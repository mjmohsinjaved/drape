import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A minimal `.env` reader for the standalone CLIs in this folder.
 *
 * The API itself never uses this — it boots `ConfigModule`, which loads `.env` and then
 * `validateRequiredEnvVars()` fails startup on anything missing (§7). But
 * `ensure-storage-root.ts` and `db-seed-check.ts` run without booting Nest, and they still
 * need `STORAGE_ROOT` / `DATABASE_URL` from the same file a developer already filled in.
 *
 * Two deliberate properties:
 *
 *  - **A real environment variable always wins.** CI sets its configuration in the process
 *    environment; a stray `.env` on a build agent must never quietly shadow it.
 *  - **It supplies nothing of its own.** Absent file, absent key, absent value — the caller
 *    still has to deal with a missing required variable. There is no default here, for the
 *    same reason there is none anywhere else (PRD E-2).
 */

/** `backend/scripts` → `backend`. */
const BACKEND_ROOT = resolve(__dirname, '..');

/** Matches `KEY=value`, tolerating `export ` and surrounding whitespace. */
const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

/**
 * Reads `backend/.env` into `process.env`, without overwriting anything already set.
 *
 * @param fileName Alternative file, relative to `backend/`. Used by tests.
 * @returns The number of variables this call actually introduced.
 */
export function loadEnvFile(fileName = '.env'): number {
  const path = resolve(BACKEND_ROOT, fileName);
  if (!existsSync(path)) {
    return 0;
  }

  let applied = 0;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const match = ASSIGNMENT.exec(line);
    if (match === null) {
      continue;
    }

    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquote(rawValue);
    applied += 1;
  }

  return applied;
}

/**
 * Strips one matching pair of surrounding quotes. Inside double quotes `\n` becomes a real
 * newline; single quotes are literal. An unquoted value keeps everything up to a ` #`
 * comment, which is the convention every `.env` parser follows.
 */
function unquote(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }

  const commentAt = trimmed.indexOf(' #');
  return (commentAt === -1 ? trimmed : trimmed.slice(0, commentAt)).trim();
}
