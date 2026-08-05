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

/**
 * The route-declaring decorators this check treats as endpoints.
 *
 * **The complete `@nestjs/common` set**, not the commonly used subset. `@All()` alone
 * registers a handler for every verb including POST, so omitting it — as this list
 * once did, along with `@Head()`, `@Options()` and `@Search()` — meant an unguarded
 * mutating route could be declared and the check would simply not see it.
 */
const ROUTE_DECORATORS: ReadonlySet<string> = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'All',
  'Head',
  'Options',
  'Search',
  'Sse',
]);

const ROLES_DECORATOR = 'Roles';
const PUBLIC_DECORATOR = 'Public';

/** Why a route failed. Printed so the fix is obvious from the CI log alone. */
type FailureReason =
  'no-contract' | 'public-without-roles' | 'class-level-public' | 'class-level-public-declaration';

interface RouteFinding {
  /** Repo-relative, forward-slashed, so the output is identical on Windows and Linux. */
  readonly file: string;
  readonly line: number;
  readonly controller: string;
  readonly handler: string;
  readonly verb: string;
  readonly path: string;
  readonly reason: FailureReason;
}

interface CheckResult {
  readonly filesScanned: number;
  readonly routesChecked: number;
  readonly failures: readonly RouteFinding[];
}

const FAILURE_EXPLANATIONS: Readonly<Record<FailureReason, string>> = {
  'no-contract': 'declares neither @Roles() nor @Public()',
  'public-without-roles': '@Public() without @Roles(Role.PUBLIC) — @Public() is not a contract',
  'class-level-public': 'inherits a class-level @Public()',
  'class-level-public-declaration': '@Public() on the controller class',
};

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * Recursively collects candidate TypeScript sources, skipping build output, tests and
 * declaration files.
 *
 * **Filename is not the filter.** The check used to look only at `*.controller.ts`, so
 * a `@Controller()` class in `admin.ts` — or in a file a refactor renamed — carried no
 * contract check at all. Every source is parsed and the `@Controller` *decorator* is
 * what selects a class; the cost is a second of parsing.
 */
function findCandidateFiles(directory: string): string[] {
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
      found.push(...findCandidateFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.spec.ts')
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

/** What one source file contributed. */
export interface FileOutcome {
  readonly routesChecked: number;
  readonly failures: readonly RouteFinding[];
}

/**
 * Analyses one source's text. Pure — no filesystem, no `process` — so the rules below
 * can be asserted directly against hand-written controllers in a unit test rather than
 * only against whatever happens to be in the repository today.
 */
export function checkSource(displayPath: string, text: string): FileOutcome {
  const source = ts.createSourceFile(
    displayPath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const failures: RouteFinding[] = [];
  let routesChecked = 0;

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
    const classLine = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;

    if (classDeclaresPublic) {
      // A class-level `@Public()` is reported once, on the class, in addition to the
      // per-route failures below. `getAllAndOverride` makes it apply to every handler,
      // so one decorator on an admin controller turns the whole controller anonymous —
      // the single highest-leverage mistake this check exists to stop, and previously
      // the one it was blindest to.
      failures.push({
        file: displayPath,
        line: classLine,
        controller: controllerName,
        handler: '(class)',
        verb: 'CLASS',
        path: `/${basePath}`.replace(/\/+/g, '/'),
        reason: 'class-level-public-declaration',
      });
    }

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) {
        continue;
      }

      const handlerDecorators = decoratorNames(member);
      const verb = [...handlerDecorators].find((name) => ROUTE_DECORATORS.has(name));
      if (verb === undefined) {
        continue;
      }

      routesChecked += 1;

      const handlerName = ts.isIdentifier(member.name)
        ? member.name.text
        : member.name.getText(source);
      const routePath = firstStringArgument(member, verb) ?? '';
      const locate = (reason: FailureReason): RouteFinding => ({
        file: displayPath,
        line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1,
        controller: controllerName,
        handler: handlerName,
        verb: verb.toUpperCase(),
        path: `/${[basePath, routePath].filter((part) => part !== '').join('/')}`.replace(
          /\/+/g,
          '/',
        ),
        reason,
      });

      const hasRoles = handlerDecorators.has(ROLES_DECORATOR) || classDeclaresRoles;
      const declaresOwnPublic = handlerDecorators.has(PUBLIC_DECORATOR);

      if (classDeclaresPublic) {
        failures.push(locate('class-level-public'));
      } else if (!hasRoles && !declaresOwnPublic) {
        failures.push(locate('no-contract'));
      } else if (!hasRoles) {
        // §2.6: "A @Public() route must still declare @Roles(Role.PUBLIC) so the B-5
        // check passes." This was a warning, and `RolesGuard` matched it by logging and
        // returning true — so a route with `@Public()` and no `@Roles()` was open to
        // anonymous callers *and* green in CI. Both ends now refuse it.
        failures.push(locate('public-without-roles'));
      }
    }
  }

  return { routesChecked, failures };
}

function checkFile(filePath: string): FileOutcome {
  return checkSource(
    relative(BACKEND_ROOT, filePath).split('\\').join('/'),
    readFileSync(filePath, 'utf8'),
  );
}

export function checkRouteGuards(root: string = CONTROLLER_ROOT): CheckResult {
  const files = findCandidateFiles(root);
  const failures: RouteFinding[] = [];
  let routesChecked = 0;
  let filesScanned = 0;

  for (const file of files) {
    const outcome = checkFile(file);
    if (outcome.routesChecked === 0 && outcome.failures.length === 0) {
      continue;
    }
    filesScanned += 1;
    routesChecked += outcome.routesChecked;
    failures.push(...outcome.failures);
  }

  return { filesScanned, routesChecked, failures };
}

function describe(finding: RouteFinding): string {
  return (
    `${finding.file}:${finding.line}  ${finding.verb} ${finding.path}  ` +
    `${finding.controller}.${finding.handler}()  — ${FAILURE_EXPLANATIONS[finding.reason]}`
  );
}

function report(result: CheckResult): void {
  write('check:guards — every route handler must declare exactly one @Roles(...) (PRD B-5).');
  write('');
  write(`  controllers scanned  ${result.filesScanned}`);
  write(`  routes checked       ${result.routesChecked}`);
  write(`  routes failing       ${result.failures.length}`);

  if (result.failures.length > 0) {
    write('');
    write('FAIL — these routes have no usable role contract:');
    for (const failure of result.failures) {
      write(`  ${describe(failure)}`);
    }
    write('');
    write('Add @Roles(Role.ADMIN | Role.CONSUMER | Role.PUBLIC) to the handler or its controller.');
    write('@Public() is not a contract: it bypasses SessionAuthGuard and says nothing about who');
    write('may call the route. A @Public() route also needs @Roles(Role.PUBLIC) and an explicit');
    write('@Throttle(). @Public() on a controller *class* is never allowed — it applies to every');
    write('handler on it, which is how a whole admin controller becomes anonymous by accident.');
    return;
  }

  write('');
  if (result.routesChecked === 0) {
    write('No route handlers found yet — nothing to check. This passes, but verify the path:');
    write(`  ${relative(BACKEND_ROOT, CONTROLLER_ROOT).split('\\').join('/')}/**/*.ts`);
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
