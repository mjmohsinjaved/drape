import {
  type NotificationChannelName,
  type NotificationLocale,
} from '../../interfaces/send-result.interface';
import { type RenderedBody } from '../layout/base-layout';

/**
 * Everything a template needs that is not template-specific. Supplied by `NotificationsService`
 * from module config, so a template function stays pure and trivially testable.
 */
export interface TemplateContext {
  readonly locale: NotificationLocale;
  readonly brandName: string;
  /** `APP_WEB_URL`. Used for the footer home link only — every action URL arrives in the props. */
  readonly webUrl: string;
  /** Address consumers are told to write to. */
  readonly supportEmail: string;
  /** `TIMEZONE`, e.g. `Asia/Karachi`. All dates in copy are formatted in it. */
  readonly timeZone: string;
}

/** What every template returns. `html` and `text` are always both populated. */
export interface RenderedTemplate extends RenderedBody {
  readonly subject: string;
}

/** A template function: strongly typed on its props, pure, no I/O. */
export type TemplateRenderer<TProps> = (
  props: TProps,
  context: TemplateContext,
) => RenderedTemplate;

/** Registry metadata, so callers know which field to use and who the message is for. */
export interface TemplateDefinition<TProps> {
  /** Delivery channel the copy was written for. SMS templates are read from `text`. */
  readonly channel: NotificationChannelName;
  /** `CONSUMER` copy passes the PRD §9.4 shortlisting check. `ADMIN` copy is operator-facing. */
  readonly audience: 'CONSUMER' | 'ADMIN';
  readonly render: TemplateRenderer<TProps>;
}
