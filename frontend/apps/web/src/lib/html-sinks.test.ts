import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { cwd } from 'node:process';

import { describe, expect, it } from 'vitest';

/**
 * No HTML or script sink in the app's own source.
 *
 * `apps/web` is the half of the frontend that holds API data. Every string it renders has
 * come over the wire from the API, and the API's validators are on a different deployment
 * cadence — a key can be added to the settings registry, or a projector changed, without
 * anyone touching this repository. So the app must not contain a construct where "the API
 * sent us a funny string" becomes "the API sent us markup".
 *
 * The one that existed: `BrandThemeProvider` concatenated `brand.primaryColor` and
 * `brand.primaryColorHover` into a `<style>` element. `primaryColorHover` had no validation
 * anywhere in either codebase. It is now a `style` attribute built by `brandThemeStyle`,
 * which returns two hex colours or nothing at all.
 *
 * ### Why this is scoped to `apps/web/src`
 *
 * `@repo/ui` renders exactly one inline script — `ThemeScript`, the first-paint mode toggle,
 * built from two `JSON.stringify`d constants with no runtime input. That is a legitimate and
 * closed use, and it is reviewed where it lives. This check is about the app that reads the
 * API, where there is no legitimate use at all.
 *
 * ### What this does not do
 *
 * It does not make the CSP safe. `next.config.ts` still ships `script-src 'unsafe-inline'`
 * in production because the App Router emits inline bootstrap and flight scripts (and the
 * `ThemeScript` above is a third). This check removes the sinks rather than relying on a
 * CSP that could not stop them.
 */

const ROOT = join(cwd(), 'src');
const EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'coverage', 'dist']);

interface SourceFile {
  label: string;
  text: string;
}

function collect(dir: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collect(full));
    } else if (
      EXTENSIONS.some((extension) => entry.endsWith(extension)) &&
      // This file has to name the banned forms in order to match them.
      !/\.(test|spec)\.tsx?$/.test(entry)
    ) {
      files.push({
        label: relative(cwd(), full).split(sep).join('/'),
        text: readFileSync(full, 'utf8'),
      });
    }
  }
  return files;
}

const SOURCES = collect(ROOT);

/** Comments legitimately name the banned forms while explaining them. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function findAll(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of SOURCES) {
    withoutComments(file.text)
      .split('\n')
      .forEach((line, index) => {
        const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(line);
        if (match) hits.push(`${file.label}:${index + 1}: ${match[0].trim()}`);
      });
  }
  return hits;
}

describe('apps/web renders no raw HTML and evaluates no strings', () => {
  it('finds source files to check', () => {
    // A silent zero would make every assertion below vacuously true.
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it('uses no dangerouslySetInnerHTML', () => {
    expect(findAll(/dangerously[S]etInnerHTML/g)).toEqual([]);
  });

  it('assigns no innerHTML or outerHTML', () => {
    expect(findAll(/\.(inner|outer)HTML\s*=/g)).toEqual([]);
  });

  it('evaluates no strings as code', () => {
    expect(findAll(/\beval\s*\(|new\s+Function\s*\(|document\.write\s*\(/g)).toEqual([]);
  });

  it('injects no script or style element built from a template string', () => {
    expect(findAll(/insertAdjacentHTML|createContextualFragment/g)).toEqual([]);
  });
});
