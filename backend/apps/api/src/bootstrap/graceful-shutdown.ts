import { Logger, type INestApplication } from '@nestjs/common';

const logger = new Logger('Shutdown');

/** How long an in-flight request has to finish before the process is forced down. */
const SHUTDOWN_GRACE_MS = 10_000;

const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Closes the application cleanly on a termination signal.
 *
 * `app.enableShutdownHooks()` (called in `main.ts`) makes Nest run every
 * `OnModuleDestroy` / `OnApplicationShutdown` hook — which is how the TypeORM pool,
 * the outbox processor and the scheduler get to stop mid-flight work. This function
 * adds the process-level wiring around it: one close attempt, a hard deadline, and
 * a non-zero exit if the close itself fails.
 */
export function registerGracefulShutdown(app: INestApplication): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.log(`${signal} received — draining, ${SHUTDOWN_GRACE_MS}ms grace`);

    const deadline = setTimeout(() => {
      logger.error('Shutdown exceeded its grace period — forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();

    try {
      await app.close();
      clearTimeout(deadline);
      logger.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      clearTimeout(deadline);
      logger.error('Shutdown failed', error instanceof Error ? error.stack : String(error));
      process.exit(1);
    }
  };

  for (const signal of SIGNALS) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(
      'Unhandled promise rejection',
      reason instanceof Error ? reason.stack : String(reason),
    );
  });

  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception — shutting down', error.stack);
    void shutdown('SIGTERM');
  });
}
