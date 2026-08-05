import { NotificationResponseDto } from '../dto/notification-response.dto';

import type { NotificationOutboxEntry } from '../entities/notification-outbox-entry.entity';

/** The rendered copy an in-app row is displayed with. Produced by the registry, never here. */
export interface RenderedNotificationCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * The plain-text layout `@library/notifications` produces is
 * `brand \n\n heading \n\n <block> \n\n … \n\n --- \n\n <footer>`.
 *
 * The first block is the template's `lead` — one sentence, written for exactly this
 * purpose. Taking it is why an in-app notification reads like a notification rather
 * than like an email with the chrome stripped off.
 */
const TEXT_SEPARATOR = '\n\n';

/** Segments that carry no message: the brand line, the heading, the footer rule. */
const FOOTER_RULE = '---';

/** Extracts the one-line body from a rendered plain-text email. */
export function leadLineOf(text: string, heading: string): string {
  const segments = text
    .split(TEXT_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  const rule = segments.indexOf(FOOTER_RULE);
  const body = rule === -1 ? segments : segments.slice(0, rule);

  // Skip the brand line and anything that merely repeats the subject.
  const lead = body.slice(1).find((segment) => segment !== heading);
  return lead ?? heading;
}

/**
 * The action a notification points at.
 *
 * Every template that has somewhere to go names its link `…Url` in its props — the
 * registry's own convention (`enquiryUrl`, `queueUrl`, `resultUrl`, `verifyUrl`). Read
 * out of the stored payload rather than out of the rendered body, because parsing an
 * href back out of HTML would break the moment a template gained a second link.
 *
 * Only `http(s)` is accepted. A payload is written by this codebase, but a URL handed
 * to a browser is a URL handed to a browser.
 */
export function actionUrlOf(payload: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(payload)) {
    if (!key.endsWith('Url') || typeof value !== 'string') {
      continue;
    }
    if (value.startsWith('https://') || value.startsWith('http://')) {
      return value;
    }
  }
  return null;
}

/**
 * One `notifications_outbox` row as the consumer sees it (A-25).
 *
 * The copy arrives already rendered: the mapper does not reach for the template
 * registry, so it stays a pure function of its inputs and a test can assert on the
 * projection without a Nest context.
 */
export function toNotificationResponse(
  entry: NotificationOutboxEntry,
  copy: RenderedNotificationCopy,
): NotificationResponseDto {
  const dto = new NotificationResponseDto();
  dto.id = entry.id;
  dto.channel = entry.channel;
  dto.template = entry.template;
  dto.locale = entry.locale;
  dto.title = copy.title;
  dto.body = copy.body;
  dto.actionUrl = actionUrlOf(entry.payload);
  dto.readAt = entry.readAt;
  dto.createdAt = entry.createdAt;
  return dto;
}
