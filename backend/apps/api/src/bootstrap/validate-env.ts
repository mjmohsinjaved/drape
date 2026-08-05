import { Logger } from '@nestjs/common';

import { config as loadDotenv } from 'dotenv';

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
  if (source === process.env) {
    // `ConfigModule.forRoot({ validate })` in `ApiModule` runs at *import* time — before
    // this function is called — and writes its validated result back to `process.env`
    // through `assignVariablesToProcess`, which copies only `string | boolean | number`
    // (@nestjs/config `config.module.js`). Any variable `validateEnv` transforms into an
    // array is therefore dropped on the way back: `CORS_ORIGINS` arrives here undefined
    // and this pass fails on a value the operator did supply.
    //
    // Re-reading `.env` restores exactly those keys. dotenv never overwrites a variable
    // already present, so a real process environment still wins (E-2) and a deployment
    // with no `.env` file is unaffected.
    loadDotenv();
  }

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
