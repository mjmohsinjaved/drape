import { Injectable, ValidationPipe, type ValidationError } from '@nestjs/common';

import { ErrorCode } from '../constants/error-codes.constant';
import { ValidationException } from '../exceptions/validation.exception';

import type { FieldError } from '../exceptions/app.exception';

/** class-validator's constraint key → the §2.3 `errors[].code`, e.g. `isEmail` → `IS_EMAIL`. */
export function constraintKeyToCode(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/**
 * Flattens class-validator's nested error tree into the flat `errors[]` array of
 * §2.3. Nested paths read `address.city`, array items read `items.0.sku`.
 */
export function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): FieldError[] {
  const flattened: FieldError[] = [];

  for (const error of errors) {
    const path = parentPath === '' ? error.property : `${parentPath}.${error.property}`;

    if (error.constraints !== undefined) {
      for (const [key, message] of Object.entries(error.constraints)) {
        flattened.push({ field: path, message, code: constraintKeyToCode(key) });
      }
    }

    if (error.children !== undefined && error.children.length > 0) {
      flattened.push(...flattenValidationErrors(error.children, path));
    }
  }

  return flattened;
}

/**
 * The global validation pipe — ARCHITECTURE.md §2.3 / §2.4 (`VALIDATION_ERROR`).
 *
 * Converts class-validator failures into a `ValidationException` carrying the
 * `errors: [{ field, message, code }]` array, so `GlobalExceptionFilter` renders the
 * standard error envelope with `errorCode: "VALIDATION_ERROR"` and the fixed copy
 * "Check the highlighted fields." rather than a raw NestJS `BadRequestException`.
 *
 * `whitelist` + `forbidNonWhitelisted` reject unknown properties, which is what
 * stops a mass-assignment attack — including the S-4 case of a `role` field in a
 * signup payload. (S-4 requires that field to be *stripped and audit-logged* rather
 * than rejected, so the auth module's signup DTO opts out of `forbidNonWhitelisted`
 * locally; everywhere else, unknown properties are an error.)
 */
@Injectable()
export class CustomValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      stopAtFirstError: false,
      exceptionFactory: (errors: ValidationError[]): ValidationException =>
        new ValidationException(ErrorCode.VALIDATION_ERROR, {
          errors: flattenValidationErrors(errors),
        }),
    });
  }
}
