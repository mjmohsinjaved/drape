import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { cwd } from 'node:process';

import { describe, expect, it } from 'vitest';

import { CLIENT_NAMESPACES, namespaces, type ClientNamespaceGroup, type Namespace } from './messages';

/**
 * The safety net under the §9.1 saving.
 *
 * `[locale]/layout.tsx` no longer hands every namespace to `NextIntlClientProvider`; each route
 * group provides the set its own client components use. That is worth ~39.5 KB of `admin.json`
 * on the public catalog grid — and it moves a class of mistake from "impossible" to "invisible
 * until someone opens the page": adding `useTranslations('shortlist')` to a component rendered
 * under `(public)` is a missing-message at runtime, not a type error.
 *
 * So this walks the real import graph from every route file, crosses into a client boundary the
 * first time it meets a `'use client'` directive, and collects the namespaces reachable from
 * there. Whatever it finds must already be declared in `CLIENT_NAMESPACES`.
 *
 * What it cannot see: a namespace assembled at runtime (`useTranslations(someVariable)`). The
 * app has none, and the assertion below that every collected name is a known `Namespace` is what
 * would notice one appearing.
 */

const SRC = join(cwd(), 'src');
const APP = join(SRC, 'app');

const ROUTE_FILE = /^(page|layout|error|loading|not-found|template|global-error)\.tsx?$/;

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isClientModule(source: string): boolean {
  return /^\s*['"]use client['"]/m.test(source.slice(0, 400));
}

/**
 * Every hook that reaches into the message tree, not just `useTranslations`.
 *
 * `useErrorCopy('renders.errors')` and `useErrorMessage('tryon')` both call `useTranslations`
 * one module away, so a component that used only those walked straight through this guard and
 * would have rendered raw keys on any route group that had not declared the namespace. There is
 * no live violation today; the matcher is widened so there cannot be a silent one tomorrow.
 *
 * Server-side `getTranslations` is deliberately absent: it reads the request config, which
 * always carries all fifteen namespaces, and costs the client bundle nothing.
 */
const MESSAGE_HOOKS = ['useTranslations', 'useErrorCopy', 'useErrorMessage'] as const;

function namespacesUsedIn(source: string): string[] {
  const pattern = new RegExp(
    `\\b(?:${MESSAGE_HOOKS.join('|')})\\(\\s*['"\`]([a-zA-Z][\\w.]*)['"\`]`,
    'g',
  );
  return [...source.matchAll(pattern)].map((match) => (match[1] ?? '').split('.')[0] ?? '');
}

/** Namespaces reachable from `file` **once inside a client boundary**. */
function clientNamespacesFrom(file: string, insideClient: boolean, seen: Set<string>): Set<string> {
  const key = `${file}|${String(insideClient)}`;
  const found = new Set<string>();
  if (seen.has(key)) return found;
  seen.add(key);

  const source = readFileSync(file, 'utf8');
  const isClient = insideClient || isClientModule(source);
  if (isClient) for (const name of namespacesUsedIn(source)) found.add(name);

  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1] ?? '');
  }

  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(specifier, file);
    if (resolved === null) continue;
    for (const name of clientNamespacesFrom(resolved, isClient, seen)) found.add(name);
  }

  return found;
}

function walk(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, into);
    else if (/\.tsx?$/.test(entry)) into.push(full);
  }
  return into;
}

/** Route files under `[locale]`, bucketed by the segment that owns their layout. */
function routeFilesByGroup(): Map<string, string[]> {
  const byGroup = new Map<string, string[]>();

  for (const file of walk(APP)) {
    const relative = file.slice(APP.length + 1).split(sep).join('/');
    if (!relative.startsWith('[locale]/')) continue;

    const rest = relative.slice('[locale]/'.length);
    const name = rest.slice(rest.lastIndexOf('/') + 1);
    if (!ROUTE_FILE.test(name)) continue;

    // Anything not inside a route group or a top-level segment sits directly under
    // `[locale]/layout.tsx`, whose provider carries the `base` set.
    const segment = rest.includes('/') ? (rest.split('/')[0] ?? '') : '__root__';
    byGroup.set(segment, [...(byGroup.get(segment) ?? []), file]);
  }

  return byGroup;
}

/** Route segment → the `CLIENT_NAMESPACES` entry whose provider wraps it. */
const GROUP_OF_SEGMENT: Readonly<Record<string, ClientNamespaceGroup>> = {
  '(public)': 'public',
  '(consumer)': 'consumer',
  '(auth)': 'auth',
  admin: 'admin',
  account: 'account',
  dashboard: 'dashboard',
  // No layout of its own — `[locale]/layout.tsx` provides `base`.
  __root__: 'base',
  'no-access': 'base',
  offline: 'base',
};

describe('§9.1 — a route group ships only the message namespaces its islands use', () => {
  const byGroup = routeFilesByGroup();

  it('has a declared provider for every segment under [locale]', () => {
    const undeclared = [...byGroup.keys()].filter((segment) => !(segment in GROUP_OF_SEGMENT));
    expect(
      undeclared,
      'a new route group needs an entry in CLIENT_NAMESPACES and in GROUP_OF_SEGMENT',
    ).toEqual([]);
  });

  it.each([...byGroup.keys()].sort())('%s declares everything its client tree reads', (segment) => {
    const group = GROUP_OF_SEGMENT[segment];
    expect(group, `${segment} is not mapped to a namespace group`).toBeDefined();
    if (group === undefined) return;

    const declared = new Set<string>(CLIENT_NAMESPACES[group]);
    const used = new Set<string>();
    for (const file of byGroup.get(segment) ?? []) {
      for (const name of clientNamespacesFrom(file, false, new Set())) used.add(name);
    }

    // Every name found must be a real namespace — a dynamic one would show up here first.
    const unknown = [...used].filter((name) => !(namespaces as readonly string[]).includes(name));
    expect(unknown, `${segment} uses a namespace that is not in \`namespaces\``).toEqual([]);

    const missing = [...used].filter((name) => !declared.has(name)).sort();
    expect(
      missing,
      `add these to CLIENT_NAMESPACES.${group}, or the strings render as raw keys`,
    ).toEqual([]);
  });

  it('keeps `base` inside every other group, because a nested provider replaces its parent', () => {
    // `NextIntlClientProvider` does not merge with an outer provider — the inner `messages`
    // wins outright. A group that dropped `common` would lose the header it renders inside.
    for (const [group, list] of Object.entries(CLIENT_NAMESPACES)) {
      for (const name of CLIENT_NAMESPACES.base) {
        expect(list as readonly Namespace[], `${group} must include ${name}`).toContain(name);
      }
    }
  });

  it('keeps the console out of the public and consumer bundles', () => {
    // The whole point of the split: `admin.json` is ~39.5 KB an anonymous visitor cannot read.
    expect(CLIENT_NAMESPACES.public as readonly string[]).not.toContain('admin');
    expect(CLIENT_NAMESPACES.consumer as readonly string[]).not.toContain('admin');
    expect(CLIENT_NAMESPACES.base as readonly string[]).not.toContain('admin');
  });
});
