import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { cwd } from 'node:process';

import { describe, expect, it } from 'vitest';

/**
 * The §6.7 RTL gate, widened to the places ESLint cannot see.
 *
 * `@repo/config-eslint` already bans physical sides, but its `no-restricted-syntax` selector
 * matches `JSXAttribute[name.name='className'] Literal[…]` — a *string literal in a className
 * attribute*. That covers the common case and misses four real ones:
 *
 *   1. `.css` files, which ESLint does not parse at all — including the shared `utilities.css`
 *      and `tokens.css`, where a physical side would poison every consumer at once.
 *   2. Template literals (`` className={`… ml-2`} ``), which are `TemplateElement`, not `Literal`.
 *   3. `cva({ variants: { … } })` maps and `cn()` arguments declared away from the JSX.
 *   4. Class strings held in a `const` and passed through a prop.
 *
 * §6.7 is absolute about this: "There are no per-side RTL overrides and no `[dir='rtl']`
 * selectors in the codebase." That only holds if nothing physical slipped in to need repairing,
 * so the check has to see the whole source tree, not just the JSX.
 *
 * What it cannot check: whether the result *looks* right in Urdu. Logical properties are
 * necessary for mirroring, not sufficient — a flex order or a background gradient can still be
 * hard-coded to one direction. Visual sign-off at 360 px in `ur` stays a human step.
 */

const ROOTS = [
  join(cwd(), 'src'),
  join(cwd(), '..', '..', 'packages', 'ui', 'src'),
  join(cwd(), '..', '..', 'packages', 'config-tailwind'),
];

const EXTENSIONS = ['.ts', '.tsx', '.css'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist']);

interface SourceFile {
  path: string;
  label: string;
  text: string;
}

function collect(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (
        EXTENSIONS.some((extension) => entry.endsWith(extension)) &&
        // The checks themselves have to name the banned forms to match them.
        !/\.(test|spec)\.tsx?$/.test(entry)
      ) {
        files.push({
          path: full,
          label: relative(cwd(), full).split(sep).join('/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return files;
}

const SOURCES = ROOTS.flatMap(collect);

/**
 * Comments explain the rule and legitimately name the banned forms, so they are stripped before
 * matching. Otherwise every docblock that says "never `ml-*`" would fail the check it documents.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `file:line: matched text` for every hit, so a failure points straight at the call site. */
function findAll(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of SOURCES) {
    const lines = withoutComments(file.text).split('\n');
    lines.forEach((line, index) => {
      const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(line);
      if (match) hits.push(`${file.label}:${index + 1}: ${match[0].trim()}`);
    });
  }
  return hits;
}

describe('§6.7 — logical CSS properties only', () => {
  it('finds source files to check', () => {
    // A silent zero would make every assertion below vacuously true.
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(SOURCES.some((file) => file.label.endsWith('.css'))).toBe(true);
  });

  it('uses no physical Tailwind side utilities', () => {
    // `border-l`/`rounded-l` need the `(?![a-z])` guard so `border-line` and `rounded-lg` — both
    // prescribed tokens — are not false positives. A physical side is always followed by end of
    // token or `-`.
    expect(
      findAll(
        /(?:^|["'\s`])-?(?:ml-|mr-|pl-|pr-|left-\d|right-\d|border-l(?![a-z])|border-r(?![a-z])|rounded-l(?![a-z])|rounded-r(?![a-z])|text-left|text-right|float-left|float-right|space-x-)/g,
      ),
    ).toEqual([]);
  });

  it('uses no physical CSS properties in a stylesheet', () => {
    // Stylesheets only. In `.ts`/`.tsx`, `left:` and `right:` are far more often an object key
    // than a declaration — `Kbd.tsx` maps `left: '←'` for the arrow key, which is a physical key
    // on a physical keyboard and correctly does not mirror. Inline style objects are covered by
    // the `marginLeft`-style check below, which cannot collide with them.
    const cssOnly = SOURCES.filter((file) => file.label.endsWith('.css'));
    const hits: string[] = [];
    const pattern =
      /(?:margin|padding|border)-(?:left|right)\s*:|(?:^|[;{\s])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)/;

    for (const file of cssOnly) {
      withoutComments(file.text)
        .split('\n')
        .forEach((line, index) => {
          const match = pattern.exec(line);
          if (match) hits.push(`${file.label}:${index + 1}: ${match[0].trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('uses no physical CSS properties in an inline style object', () => {
    expect(
      findAll(
        /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\b/g,
      ),
    ).toEqual([]);
  });

  it('carries no [dir] override anywhere', () => {
    // §6.7: direction is handled by logical properties alone. A `[dir='rtl']` selector is the
    // signature of a physical property that was patched rather than replaced.
    expect(findAll(/\[dir=|:dir\(/g)).toEqual([]);
  });

  it('leaves no direction-bearing custom property undefined', () => {
    // A `var(--x, right)` whose `--x` is never declared is a physical fallback in disguise: it
    // always resolves to the hard-coded side, and it reads as if direction were handled.
    const declared = new Set<string>();
    const referenced = new Map<string, string>();

    for (const file of SOURCES) {
      // Comments are stripped on both sides: a docblock explaining why a directional variable
      // was removed must not read as a live reference to it.
      const code = withoutComments(file.text);
      for (const match of code.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
        if (match[1]) declared.add(match[1]);
      }
      for (const match of code.matchAll(
        /var\(\s*(--[a-z0-9-]+)\s*,\s*(left|right|ltr|rtl)\s*\)/g,
      )) {
        if (match[1]) referenced.set(match[1], `${file.label}: ${match[0]}`);
      }
    }

    const undeclared = [...referenced.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([, where]) => where);
    expect(undeclared).toEqual([]);
  });
});
