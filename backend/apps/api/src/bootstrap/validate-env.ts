import { Logger } from '@nestjs/common';

import {
  EnvironmentValidationError,
  type EnvironmentVariables,
  validateEnv,
} from '@api/config/env.validation';

const logger = new Logger('Bootstrap');

/**
 * ARCHITECTURE §7 — called **before** `NestFactory.create()`.
 *
 * A missing or malformed variable fails startup, never a request. Every problem is
 * reported in one pass so a half-configured deployment is fixed in one edit.
 *
 * Nothing here is ever logged with its value: names and constraints only.
 */
export function validateRequiredEnvVars(
  source: NodeJS.ProcessEnv = process.env,
): EnvironmentVariables {
  try {
    return validateEnv(source);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
