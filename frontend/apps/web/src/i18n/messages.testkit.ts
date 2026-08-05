import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';

import { locales, type Locale } from './config';
import { namespaces, type Namespace } from './messages';

/**
 * Shared reader for the message-catalogue checks (`copy-check.test.ts`, `locale-parity.test.ts`).
 *
 * The catalogues are read from disk as JSON rather than imported through `loadMessages`, because
 * both checks need to see each locale's file *exactly as authored* — `loadMessages` deep-merges
 * `ur` over `en`, which is precisely the fallback the parity check exists to detect.
 *
 * Not imported by any component; it is test scaffolding that lives beside the thing it reads.
 */

const MESSAGES_DIR = join(cwd(), 'src', 'i18n', 'messages');

export type MessageTree = Record<string, unknown>;

/** Every key path in a namespace, flattened to `a.b.c`, with its string value. */
export type FlatMessages = Record<string, string>;

export function flatten(tree: MessageTree, prefix = ''): FlatMessages {
  const flat: FlatMessages = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(flat, flatten(value as MessageTree, path));
    } else {
      flat[path] = String(value);
    }
  }
  return flat;
}

export function readNamespace(locale: Locale, namespace: Namespace): FlatMessages {
  const file = join(MESSAGES_DIR, locale, `${namespace}.json`);
  return flatten(JSON.parse(readFileSync(file, 'utf8')) as MessageTree);
}

/** The `.json` files actually on disk for a locale, so a new namespace cannot be forgotten. */
export function namespaceFilesOnDisk(locale: Locale): string[] {
  return readdirSync(join(MESSAGES_DIR, locale))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

export const ALL_LOCALES: readonly Locale[] = locales;
export const ALL_NAMESPACES: readonly Namespace[] = namespaces;

/**
 * Namespaces a consumer can read. `admin` is excluded from the §9.4 shortlisting rules — the
 * studio team is allowed to call a test render a test render — but §10.5 (active voice, plain
 * verbs, D-13 naming) still applies to it and is checked separately.
 */
export const CONSUMER_NAMESPACES: readonly Namespace[] = ALL_NAMESPACES.filter(
  (namespace) => namespace !== 'admin',
);

/**
 * The ICU argument names a string interpolates, sorted.
 *
 * Only *arguments* count — an argument name is always followed by `,` (typed argument) or `}`
 * (simple placeholder). The prose inside a plural branch (`one {It costs …}`) is not, which is
 * why the trailing `[,}]` matters: without it, `{It's` reads as an argument called `It`.
 */
export function icuArguments(value: string): string[] {
  return [...value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)].map((match) => match[1] ?? '').sort();
}

/** ICU keywords that are syntax, not copy, and are Latin in every locale. */
const ICU_KEYWORDS =
  /\b(plural|selectordinal|select|offset|zero|one|two|few|many|other|number|date|time|currency)\b/g;

/**
 * The human-readable prose of a string, with every piece of ICU machinery removed: argument
 * names, type/format keywords, `=0` selectors and the braces themselves. What is left is what a
 * reader actually sees, which is the only part a language check should look at.
 */
export function icuProse(value: string): string {
  return value
    .replace(/\{\s*[a-zA-Z0-9_]+\s*,/g, '{') // `{count, plural, …` → `{ …`
    .replace(/\{\s*[a-zA-Z0-9_]+\s*\}/g, ' ') // `{amount}` → ` `
    .replace(/=\d+\s*\{/g, '{') // `=0 {` → `{`
    .replace(ICU_KEYWORDS, ' ')
    .replace(/[{}#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every consumer-facing string in one locale, keyed `namespace.a.b.c`. */
export function consumerStrings(locale: Locale): FlatMessages {
  const all: FlatMessages = {};
  for (const namespace of CONSUMER_NAMESPACES) {
    for (const [key, value] of Object.entries(readNamespace(locale, namespace))) {
      all[`${namespace}.${key}`] = value;
    }
  }
  return all;
}
