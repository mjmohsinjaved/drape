import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as ts from 'typescript';

/**
 * `npm run check:guards` — PRD B-5 / E-16.
 *
 * "Every API endpoint declares its required role through a guard. An endpoint without an
 * explicit role guard fails CI."
 *
 * A guard that is only *usually* applied is not a guard. `RolesGuard` runs on every route
 * (§2.7), but a handler that declares no `@Roles()` has no contract for it to enforce — the
 * route silently becomes whatever the guard's default is. This script removes that
 * possibility by refusing to let such a handler exist at all.
 *
 * It works on the syntax tree, not on a booted application: no database, no environment, no
 * Nest container, so it runs in a second on a machine that has neither.
 */

/** `backend/scripts` → `backend`. */
const BACKEND_ROOT = resolve(__dirname, '..');
const CONTROLLER_ROOT = resolve(BACKEND_ROOT, 'apps', 'api', 'src');

/** The route-declaring decorators this check treats as endpoints. */
const ROUTE_DECORATORS: ReadonlySet<string> = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Sse',
]);

const ROLES_DECORATOR = 'Roles';
const PUBLIC_DECORATOR = 'Public';

interface RouteFinding {
  /** Repo-relative, forward-slashed, so the output is identical on Windows and Linux. */
  readonly file: string;
  readonly line: number;
  readonly controller: string;
  readonly handler: string;
  readonly verb: string;
  readonly path: string;
}

interface CheckResult {
  readonly filesScanned: number;
  readonly routesChecked: number;
  readonly failures: readonly RouteFinding[];
  /** `@Public()` without `@Roles(Role.PUBLIC)` — §2.6 asks for both. Reported, not fatal. */
  readonly warnings: readonly RouteFinding[];
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Recursively collects `*.controller.ts`, skipping build output and declaration files. */
function findControllerFiles(directory: string): string[] {
  const found: string[] = [];

  // `ReturnType<typeof readdirSync>` resolves to the Buffer overload under
  // @types/node 24, which makes `entry.name` a Buffer. Pin the string form.
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      found.push(...findControllerFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(full);
    }
  }

  return found.sort();
}

/** `@Roles(Role.ADMIN)` → `Roles`; `@Get()` → `Get`; `@common.Get()` → `Get`. */
function decoratorName(decorator: ts.Decorator): string | undefined {
  const expression = ts.isCallExpression(decorator.expression)
    ? decorator.expression.expression
    : decorator.expression;

  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function decoratorNames(node: ts.Node): ReadonlySet<string> {
  const names = new Set<string>();
  for (const decorator of decoratorsOf(node)) {
    const name = decoratorName(decorator);
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}

/** First string-literal argument of a decorator, e.g. the path in `@Get(':id')`. */
function firstStringArgument(node: ts.Node, wanted: string): string | undefined {
  for (const decorator of decoratorsOf(node)) {
    if (decoratorName(decorator) !== wanted || !ts.isCallExpression(decorator.expression)) {
      continue;
    }
    const [argument] = decorator.expression.arguments;
    if (argument !== undefined && ts.isStringLiteralLike(argument)) {
      return argument.text;
    }
  }
  return undefined;
}

function checkFile(
  filePath: string,
  result: { routesChecked: number },
): {
  failures: RouteFinding[];
  warnings: RouteFinding[];
} {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const displayPath = relative(BACKEND_ROOT, filePath).split('\\').join('/');
  const failures: RouteFinding[] = [];
  const warnings: RouteFinding[] = [];

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) {
      continue;
    }

    const classDecorators = decoratorNames(statement);
    if (!classDecorators.has('Controller')) {
      continue;
    }

    const controllerName = statement.name?.text ?? '(anonymous)';
    const basePath = firstStringArgument(statement, 'Controller') ?? '';
    const classDeclaresRoles = classDecorators.has(ROLES_DECORATOR);
    const classDeclaresPublic = classDecorators.has(PUBLIC_DECORATOR);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) {
        continue;
      }

      const handlerDecorators = decoratorNames(member);
      const verb = [...handlerDecorators].find((name) => ROUTE_DECORATORS.has(name));
      if (verb === undefined) {
        continue;
      }

      result.routesChecked += 1;

      const handlerName = ts.isIdentifier(member.name)
        ? member.name.text
        : member.name.getText(source);
      const routePath = firstStringArgument(member, verb) ?? '';
      const finding: RouteFinding = {
        file: displayPath,
        line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1,
        controller: controllerName,
        handler: handlerName,
        verb: verb.toUpperCase(),
        path: `/${[basePath, routePath].filter((part) => part !== '').join('/')}`.replace(
          /\/+/g,
          '/',
        ),
      };

      const hasRoles = handlerDecorators.has(ROLES_DECORATOR) || classDeclaresRoles;
      const hasPublic = handlerDecorators.has(PUBLIC_DECORATOR) || classDeclaresPublic;

      if (!hasRoles && !hasPublic) {
        failures.push(finding);
      } else if (hasPublic && !hasRoles) {
        // §2.6: "A @Public() route must still declare @Roles(Role.PUBLIC) so the B-5 check
        // passes." Surfaced so it gets fixed, but it is not the B-5 failure itself.
        warnings.push(finding);
      }
    }
  }

  return { failures, warnings };
}

export function checkRouteGuards(): CheckResult {
  const files = findControllerFiles(CONTROLLER_ROOT);
  const counter = { routesChecked: 0 };
  const failures: RouteFinding[] = [];
  const warnings: RouteFinding[] = [];

  for (const file of files) {
    const outcome = checkFile(file, counter);
    failures.push(...outcome.failures);
    warnings.push(...outcome.warnings);
  }

  return { filesScanned: files.length, routesChecked: counter.routesChecked, failures, warnings };
}

function describe(finding: RouteFinding): string {
  return `${finding.file}:${finding.line}  ${finding.verb} ${finding.path}  ${finding.controller}.${finding.handler}()`;
}

function report(result: CheckResult): void {
  write('check:guards — every route handler must declare @Roles(...) or @Public() (PRD B-5).');
  write('');
  write(`  controllers scanned  ${result.filesScanned}`);
  write(`  routes checked       ${result.routesChecked}`);
  write(`  routes failing       ${result.failures.length}`);
  write(`  warnings             ${result.warnings.length}`);

  if (result.warnings.length > 0) {
    write('');
    write('WARN — @Public() without @Roles(Role.PUBLIC) (ARCHITECTURE.md §2.6 asks for both):');
    for (const warning of result.warnings) {
      write(`  ${describe(warning)}`);
    }
  }

  if (result.failures.length > 0) {
    write('');
    write('FAIL — these route handlers declare no role contract:');
    for (const failure of result.failures) {
      write(`  ${describe(failure)}`);
    }
    write('');
    write('Add @Roles(Role.ADMIN | Role.CONSUMER | Role.PUBLIC) to the handler or its controller.');
    write('A @Public() route also needs @Roles(Role.PUBLIC) and an explicit @Throttle().');
    return;
  }

  write('');
  if (result.routesChecked === 0) {
    write('No route handlers found yet — nothing to check. This passes, but verify the path:');
    write(`  ${relative(BACKEND_ROOT, CONTROLLER_ROOT).split('\\').join('/')}/**/*.controller.ts`);
    return;
  }
  write('OK — every route handler declares its role contract.');
}

if (require.main === module) {
  const result = checkRouteGuards();
  report(result);
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}
