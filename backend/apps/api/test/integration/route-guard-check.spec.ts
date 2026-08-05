import { checkRouteGuards, checkSource } from '../../../../scripts/check-route-guards';

/**
 * **The B-5 check, checked.**
 *
 * `npm run check:guards` is the thing standing between a handler with no authorisation
 * contract and production, and it had three blind spots — each of which let an unguarded or
 * anonymous route through a green build:
 *
 *  1. a **class-level `@Public()`** set `hasPublic` for every handler on the controller, and
 *     `@Public()` without `@Roles()` was only a *warning*. `RolesGuard` matched that exactly
 *     — logged and returned true — so one decorator on an admin controller made every route
 *     on it anonymous, and CI stayed green.
 *  2. `ROUTE_DECORATORS` omitted `All`, `Head`, `Options` and `Search`. `@All()` registers a
 *     handler for **every** verb, POST included.
 *  3. only `*.controller.ts` was scanned, so a `@Controller` class in any other file was
 *     invisible.
 *
 * These assertions run the real script functions over hand-written controllers, so a
 * regression is caught here rather than by whatever happens to be in the repository today.
 */
describe('check:guards (B-5)', () => {
  const reasons = (source: string): string[] =>
    checkSource('probe.ts', source).failures.map((failure) => failure.reason);

  describe('a @Public() route with no @Roles()', () => {
    it('fails, where it used to warn', () => {
      expect(
        reasons(`
          @Controller('admin')
          class AdminController {
            @Get('consumers')
            @Public()
            list() { return []; }
          }
        `),
      ).toEqual(['public-without-roles']);
    });

    it('passes once @Roles(Role.PUBLIC) states the contract', () => {
      expect(
        reasons(`
          @Controller('health')
          class HealthController {
            @Get()
            @Public()
            @Roles(Role.PUBLIC)
            live() { return {}; }
          }
        `),
      ).toEqual([]);
    });
  });

  describe('a class-level @Public()', () => {
    const source = `
      @Controller('admin')
      @Public()
      class AdminController {
        @Get('consumers')
        @Roles(Role.ADMIN)
        list() { return []; }

        @Post('consumers/:id/suspend')
        @Roles(Role.ADMIN)
        suspend() { return {}; }
      }
    `;

    it('is rejected outright, and every route under it is reported too', () => {
      // Once for the class, once per handler: the CI log names the decorator to delete and
      // every route it silently opened.
      expect(reasons(source)).toEqual([
        'class-level-public-declaration',
        'class-level-public',
        'class-level-public',
      ]);
    });

    it('is rejected even though each handler declares a perfectly good @Roles()', () => {
      // This is the case the old check called clean: `hasRoles` was true for every handler,
      // so nothing was reported at all.
      expect(checkSource('probe.ts', source).failures).not.toHaveLength(0);
    });
  });

  describe('the route decorators it recognises', () => {
    it.each(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options', 'Search', 'Sse'])(
      'sees an unguarded @%s()',
      (verb) => {
        expect(
          reasons(`
            @Controller('thing')
            class ThingController {
              @${verb}()
              handler() { return {}; }
            }
          `),
        ).toEqual(['no-contract']);
      },
    );

    it('counts @All() as a route — it registers POST like any other', () => {
      expect(
        checkSource(
          'probe.ts',
          `
            @Controller('thing')
            class ThingController {
              @All()
              @Roles(Role.ADMIN)
              handler() { return {}; }
            }
          `,
        ).routesChecked,
      ).toBe(1);
    });
  });

  describe('how it finds controllers', () => {
    it('selects on the @Controller decorator, not on the filename', () => {
      // The filename is deliberately not `*.controller.ts`.
      expect(
        reasons(`
          @Controller('admin')
          class TuckedAwayController {
            @Get('secrets')
            leak() { return {}; }
          }
        `),
      ).toEqual(['no-contract']);
    });

    it('ignores a class that is not a @Controller', () => {
      expect(
        checkSource(
          'probe.ts',
          `
            class NotAController {
              @Get('nope')
              handler() { return {}; }
            }
          `,
        ),
      ).toEqual({ routesChecked: 0, failures: [] });
    });

    it('accepts a class-level @Roles() as the contract for its handlers', () => {
      expect(
        reasons(`
          @Controller('admin')
          @Roles(Role.ADMIN)
          class AdminController {
            @Get('consumers')
            list() { return []; }
          }
        `),
      ).toEqual([]);
    });
  });

  /** The whole repository, through the same entry point `npm run check:guards` uses. */
  it('passes over apps/api/src as it stands', () => {
    const result = checkRouteGuards();

    expect(result.failures).toEqual([]);
    expect(result.routesChecked).toBeGreaterThan(0);
  });
});
