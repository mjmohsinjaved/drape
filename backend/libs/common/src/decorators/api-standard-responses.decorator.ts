import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse as SwaggerApiResponse } from '@nestjs/swagger';

import { ERROR_CODE_SPECS, ErrorCode } from '../constants/error-codes.constant';

/**
 * The `errors[]` item schema of §2.3.
 * Written as a literal schema rather than a DTO class so that no runtime class has
 * to exist purely for documentation.
 */
const fieldErrorSchema = {
  type: 'object',
  required: ['field', 'message'],
  properties: {
    field: { type: 'string', example: 'email' },
    message: { type: 'string', example: 'email must be an email' },
    code: { type: 'string', example: 'IS_EMAIL' },
  },
};

// The return type is inferred rather than annotated: an explicit
// `Record<string, unknown>` would not be assignable to Swagger's `SchemaObject`.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function errorSchema(status: HttpStatus, codes: readonly ErrorCode[]) {
  const primary = codes[0] ?? ErrorCode.INTERNAL_ERROR;
  return {
    type: 'object',
    required: [
      'success',
      'statusCode',
      'errorCode',
      'message',
      'errors',
      'timestamp',
      'path',
      'requestId',
    ],
    properties: {
      success: { type: 'boolean', example: false },
      statusCode: { type: 'integer', example: status },
      errorCode: {
        type: 'string',
        enum: codes.map((code) => String(code)),
        example: String(primary),
        description: 'A member of the closed `ErrorCode` set (ARCHITECTURE.md §2.4).',
      },
      message: {
        type: 'string',
        description: 'Always safe to display to the end user.',
        example: ERROR_CODE_SPECS[primary].message,
      },
      errors: { type: 'array', items: fieldErrorSchema },
      details: {
        type: 'object',
        additionalProperties: true,
        nullable: true,
        description: 'Typed, non-sensitive data the UI needs to render the state.',
      },
      timestamp: { type: 'string', format: 'date-time' },
      path: { type: 'string', example: '/api/v1/catalog/garments' },
      requestId: { type: 'string', format: 'uuid' },
    },
  };
}

/** Which standard error responses to document. Everything defaults to on except 404 and 409. */
export interface ApiStandardResponsesOptions {
  /** 401 + 403. Default true. Set false only on a `@Roles(Role.PUBLIC)` route. */
  auth?: boolean;
  /** 400 validation envelope. Default true. */
  validation?: boolean;
  /** 404. Default false — enable on routes that take a resource id. */
  notFound?: boolean;
  /** 409. Default false — enable on routes with a state machine or a unique constraint. */
  conflict?: boolean;
  /** 422. Default false — enable on image and photo routes. */
  unprocessable?: boolean;
  /** 429. Default true. */
  rateLimited?: boolean;
  /** 500. Default true. */
  internal?: boolean;
}

/**
 * Documents the standard §2.3 error envelopes on a route.
 *
 * Every handler carries this so the exported OpenAPI document (B-4) describes the
 * failure shapes the web app's generated client must handle, not just the happy path.
 *
 * ```typescript
 * @Get(':id')
 * @Roles(Role.CONSUMER)
 * @ApiStandardResponses({ notFound: true })
 * findOne(@Param() params: IdParamDto) { … }
 * ```
 */
export function ApiStandardResponses(
  options: ApiStandardResponsesOptions = {},
): ReturnType<typeof applyDecorators> {
  const {
    auth = true,
    validation = true,
    notFound = false,
    conflict = false,
    unprocessable = false,
    rateLimited = true,
    internal = true,
  } = options;

  const decorators: Array<ClassDecorator | MethodDecorator | PropertyDecorator> = [];

  if (validation) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.BAD_REQUEST,
        description: 'Validation failed. `errors[]` carries the per-field detail.',
        schema: errorSchema(HttpStatus.BAD_REQUEST, [
          ErrorCode.VALIDATION_ERROR,
          ErrorCode.PASSWORD_POLICY_VIOLATION,
          ErrorCode.TOKEN_INVALID,
        ]),
      }),
    );
  }

  if (auth) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.UNAUTHORIZED,
        description: 'No session, or an expired session.',
        schema: errorSchema(HttpStatus.UNAUTHORIZED, [
          ErrorCode.AUTH_REQUIRED,
          ErrorCode.SESSION_EXPIRED,
          ErrorCode.SESSION_INVALID,
        ]),
      }),
      SwaggerApiResponse({
        status: HttpStatus.FORBIDDEN,
        description: 'Authenticated but not permitted, or a CSRF double-submit failure.',
        schema: errorSchema(HttpStatus.FORBIDDEN, [
          ErrorCode.INSUFFICIENT_ROLE,
          ErrorCode.CSRF_TOKEN_MISSING,
          ErrorCode.CSRF_TOKEN_INVALID,
          ErrorCode.ACCOUNT_SUSPENDED,
        ]),
      }),
    );
  }

  if (notFound) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.NOT_FOUND,
        description:
          'The resource does not exist, or the caller does not own it — the two are ' +
          'indistinguishable by design (§2.4 masking rule, S-9).',
        schema: errorSchema(HttpStatus.NOT_FOUND, [ErrorCode.RESOURCE_NOT_FOUND]),
      }),
    );
  }

  if (conflict) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.CONFLICT,
        description: 'The request conflicts with the current state of the resource.',
        schema: errorSchema(HttpStatus.CONFLICT, [ErrorCode.RESOURCE_CONFLICT]),
      }),
    );
  }

  if (unprocessable) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        description: 'The payload was well-formed but failed a domain check.',
        schema: errorSchema(HttpStatus.UNPROCESSABLE_ENTITY, [
          ErrorCode.PHOTO_VALIDATION_FAILED,
          ErrorCode.IMAGE_TOO_SMALL,
          ErrorCode.IMAGE_CORRUPT,
        ]),
      }),
    );
  }

  if (rateLimited) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.TOO_MANY_REQUESTS,
        description:
          'Rate limited. `details.retryAfterSeconds` and a `Retry-After` header are set.',
        schema: errorSchema(HttpStatus.TOO_MANY_REQUESTS, [ErrorCode.RATE_LIMIT_EXCEEDED]),
      }),
    );
  }

  if (internal) {
    decorators.push(
      SwaggerApiResponse({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        description: 'Unexpected failure. The detail is logged server-side against the request id.',
        schema: errorSchema(HttpStatus.INTERNAL_SERVER_ERROR, [ErrorCode.INTERNAL_ERROR]),
      }),
    );
  }

  return applyDecorators(...decorators);
}
