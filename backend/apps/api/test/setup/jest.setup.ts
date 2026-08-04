import 'reflect-metadata';

import { Logger } from '@nestjs/common';

import { applyTestEnv } from './test-env';
import { restoreClock } from './time';

/**
 * Global test setup — referenced by `backend/jest.config.js` (`setupFilesAfterEnv`) and by
 * `apps/api/test/jest-e2e.json`.
 *
 * It does four things, all of them about making a failure mean something:
 *
 *  1. Installs a safe, fake environment so no test needs a database, a storage root or a
 *     real secret (`test-env.ts`).
 *  2. Silences the structured logger, so a passing run is quiet and a failing one is
 *     readable. Set `DRAPE_TEST_LOGS=1` to get everything back while debugging.
 *  3. Fails the test that produced an unhandled promise rejection, rather than letting the
 *     process swallow it. PRD E-11 says "no unhandled promise rejections"; this is where
 *     that stops being an aspiration.
 *  4. Restores real timers after every test, so a frozen clock never leaks across files.
 */

applyTestEnv();

const showLogs = process.env.DRAPE_TEST_LOGS === '1';

/**
 * Rejections captured since the last assertion point. Recorded rather than thrown at the
 * moment they arrive, because Node emits them asynchronously and throwing from the handler
 * would attribute them to whatever test happened to be running microseconds later.
 */
const unhandledRejections: unknown[] = [];

function recordUnhandledRejection(reason: unknown): void {
  unhandledRejections.push(reason);
}

process.on('unhandledRejection', recordUnhandledRejection);

beforeAll(() => {
  if (!showLogs) {
    // Nest writes through this, including every `StructuredLoggerService` line.
    Logger.overrideLogger(false);
  }
});

beforeEach(() => {
  unhandledRejections.length = 0;

  if (!showLogs) {
    // Anything that bypassed the Logger. `no-console` makes this rare, but a dependency
    // can still be chatty, and jest.spyOn is undone by `restoreMocks` in jest.config.js.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  }
});

afterEach(() => {
  restoreClock();

  if (unhandledRejections.length > 0) {
    const [first] = unhandledRejections;
    const count = unhandledRejections.length;
    unhandledRejections.length = 0;

    const detail = first instanceof Error ? (first.stack ?? first.message) : String(first);
    throw new Error(
      `Unhandled promise rejection during this test (${count} total). ` +
        'Every external call is wrapped with a timeout, a retry policy and typed error ' +
        `handling (PRD E-11) — an unhandled rejection means one is not.\n\n${detail}`,
    );
  }
});

afterAll(() => {
  process.off('unhandledRejection', recordUnhandledRejection);
});
