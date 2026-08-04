import { type EmailProvider } from './email-provider.interface';
import { type NotificationLocale } from './send-result.interface';
import { type SmsProvider } from './sms-provider.interface';
import { type SmsRequestBody } from './sms-transport.interface';

export const EMAIL_DRIVERS = ['console', 'smtp'] as const;
export type EmailDriver = (typeof EMAIL_DRIVERS)[number];

export const SMS_DRIVERS = ['console', 'http'] as const;
export type SmsDriver = (typeof SMS_DRIVERS)[number];

/** SMTP transport settings. Credentials are required and never defaulted (E-2). */
export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  /** Implicit TLS. `SMTP_SECURE`. */
  readonly secure: boolean;
  /** Reused sockets per transporter. */
  readonly maxConnections?: number;
  readonly maxMessages?: number;
}

/** Generic REST SMS gateway settings. The credential is required and never defaulted (E-2). */
export interface HttpSmsTransportOptions {
  /** `SMS_HTTP_URL`. */
  readonly url: string;
  /** `SMS_HTTP_API_KEY`. No fallback, ever. */
  readonly apiKey: string;
  /** Header carrying the credential. Defaults to `Authorization`. */
  readonly authHeaderName?: string;
  /** Scheme prefix. Defaults to `Bearer`. Set to `''` to send the raw key. */
  readonly authScheme?: string;
  /** Extra static headers the gateway needs. Never put a credential here as a default. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /** Overrides the request body for a gateway with a different field naming. */
  readonly buildRequestBody?: (to: string, text: string, senderId: string) => SmsRequestBody;
  /** Overrides how the gateway's message id is read out of the response. */
  readonly readMessageId?: (data: unknown) => string | null;
}

/** Everything the library needs, resolved from env by `loadNotificationsConfigFromEnv()`. */
export interface NotificationsConfig {
  readonly emailDriver: EmailDriver;
  /** `EMAIL_FROM`, e.g. `Drape <hello@example.com>`. */
  readonly emailFrom: string;
  /** Required when `emailDriver` is `smtp`. */
  readonly smtp?: SmtpTransportOptions;

  readonly smsDriver: SmsDriver;
  /** `SMS_SENDER_ID`. Required when `smsDriver` is `http`. */
  readonly smsSenderId?: string;
  /** Required when `smsDriver` is `http`. */
  readonly httpSms?: HttpSmsTransportOptions;

  /** `APP_WEB_URL`. Every link in every template is built from it. */
  readonly webUrl: string;
  /** Shown in the email header and footer. */
  readonly brandName: string;
  /** Address consumers are told to write to. Appears in account-state emails. */
  readonly supportEmail: string;
  /** Fallback locale when a recipient has no stored preference. */
  readonly defaultLocale: NotificationLocale;
  /** `TIMEZONE`. Every date printed in template copy is formatted in it. */
  readonly timeZone: string;

  /** Per-attempt deadline (E-11). */
  readonly timeoutMs: number;
  /** Retry ceiling, inclusive of the first try (E-11). */
  readonly maxAttempts: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
  /** 0–1. Proportion of the computed delay added at random to avoid a thundering herd. */
  readonly backoffJitterRatio: number;

  /**
   * Let the console drivers log the rendered body at `debug`. Off by default: verification and
   * reset links are secrets, even locally.
   */
  readonly consoleLogBody: boolean;
}

/** `NotificationsModule.forRoot()` input. */
export interface NotificationsModuleOptions extends NotificationsConfig {
  /**
   * Replaces driver selection entirely. This is the seam that lets a new provider drop in without
   * touching a single caller — and the seam tests use.
   */
  readonly emailProvider?: EmailProvider;
  readonly smsProvider?: SmsProvider;
}

/** `NotificationsModule.forRootAsync()` input. */
export interface NotificationsModuleAsyncOptions {
  /** Modules exporting whatever `inject` asks for, e.g. `ConfigModule`. */
  readonly imports?: readonly unknown[];
  readonly inject?: readonly unknown[];
  readonly useFactory: (
    ...args: never[]
  ) => NotificationsModuleOptions | Promise<NotificationsModuleOptions>;
}
