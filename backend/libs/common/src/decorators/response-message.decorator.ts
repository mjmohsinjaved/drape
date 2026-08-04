import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key read by `ResponseTransformInterceptor`. */
export const RESPONSE_MESSAGE_KEY = 'responseMessage';

/** The envelope `message` when a handler sets none. */
export const DEFAULT_RESPONSE_MESSAGE = 'Success';

/**
 * Sets `message` in the success envelope — ARCHITECTURE.md §2.3 / §2.6.
 * The default is `"Success"`. The message is always safe to display to the user.
 */
export const ResponseMessage = (message: string): CustomDecorator<string> =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
