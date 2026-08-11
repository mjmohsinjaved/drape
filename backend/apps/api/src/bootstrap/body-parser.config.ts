import type { NestExpressApplication } from '@nestjs/platform-express';

export const JSON_BODY_LIMIT = '1mb';

export function registerBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
