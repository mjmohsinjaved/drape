import type { LoggerService, LogLevel } from '@nestjs/common';

import { redact, redactObject, redactString } from '../utils/redact.util';

import { RequestContext } from './request-context';

/** Log levels in ascending severity. `verbose` maps onto NestJS's `verbose`. */
export const LOG_LEVELS = ['debug', 'verbose', 'log', 'warn', 'error', 'fatal'] as const;

/** A level accepted by `LOG_LEVEL`. */
export type StructuredLogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_SEVERITY: Readonly<Record<StructuredLogLevel, number>> = {
  debug: 10,
  verbose: 20,
  log: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** `LOG_LEVEL` accepts `debug | info | warn | error` (§7); `info` means `log`. */
const LEVEL_ALIASES: Readonly<Record<string, StructuredLogLevel>> = {
  info: 'log',
  trace: 'verbose',
  warning: 'warn',
  critical: 'fatal',
};

/** One emitted log record. Serialised as a single line of JSON. */
export interface StructuredLogRecord {
  timestamp: string;
  level: StructuredLogLevel;
  message: string;
  context?: string;
  /** The request id (E-12). Present for anything logged inside a request. */
  traceId?: string;
  userId?: string;
  method?: string;
  path?: string;
  durationMs?: number;
  stack?: string;
  [key: string]: unknown;
}

/** Extra fields merged into a record. Redacted before emission. */
export type LogMeta = Record<string, unknown>;

/** The transport a record is written to. Replaceable in tests. */
export interface LogWriter {
  write(line: string): void;
}

const defaultWriter: LogWriter = {
  write(line: string): void {
    // `console.log` is forbidden (CLAUDE.md); writing to the stream directly also
    // avoids Node's console formatting mangling the JSON.
    process.stdout.write(`${line}\n`);
  },
};

function normaliseLevel(
  value: string | undefined,
  fallback: StructuredLogLevel,
): StructuredLogLevel {
  if (value === undefined) {
    return fallback;
  }
  const lower = value.trim().toLowerCase();
  const aliased = LEVEL_ALIASES[lower] ?? lower;
  return (LOG_LEVELS as readonly string[]).includes(aliased) ? aliased : fallback;
}

/** Construction options. `LOG_LEVEL` is read from the environment when omitted. */
export interface StructuredLoggerOptions {
  level?: StructuredLogLevel;
  /** Prefixes every record. Usually the class name. */
  context?: string;
  writer?: LogWriter;
  /** Emit indented JSON. Useful locally; never in staging or production. */
  pretty?: boolean;
}

/**
 * JSON structured logger — PRD E-12.
 *
 * Implements `LoggerService` so it can be handed to `NestFactory.create({ logger })`
 * and returned by `new Logger(Foo.name)` call sites unchanged. Every record carries
 * the `traceId` pulled from `RequestContext`, and every message and metadata object
 * passes through `redact()` before it is written — no photo URL, storage key, token
 * or personal data reaches a log line.
 *
 * `console.log` is never used, here or anywhere else in the codebase.
 *
 * Deliberately **not** `@Injectable()`: the constructor takes an options object, so
 * registering it as a bare `useClass` provider could not be resolved by the
 * injector. Bind it with `useValue` / `useFactory`, or construct it directly.
 */
export class StructuredLoggerService implements LoggerService {
  private readonly writer: LogWriter;
  private readonly pretty: boolean;
  private minimumSeverity: number;
  private context?: string;

  constructor(options: StructuredLoggerOptions = {}) {
    this.writer = options.writer ?? defaultWriter;
    this.context = options.context;
    this.pretty = options.pretty ?? false;
    this.minimumSeverity =
      LEVEL_SEVERITY[options.level ?? normaliseLevel(process.env.LOG_LEVEL, 'log')];
  }

  /** A child logger bound to a class or subsystem name. */
  withContext(context: string): StructuredLoggerService {
    const child = new StructuredLoggerService({
      writer: this.writer,
      pretty: this.pretty,
      context,
    });
    child.setMinimumSeverity(this.minimumSeverity);
    return child;
  }

  /** NestJS calls this when a logger is attached to an injection context. */
  setContext(context: string): void {
    this.context = context;
  }

  /** `LoggerService.setLogLevels` — accepted so Nest can reconfigure at bootstrap. */
  setLogLevels(levels: LogLevel[]): void {
    const lowest = levels
      .map((level) => LEVEL_SEVERITY[normaliseLevel(level, 'log')])
      .sort((a, b) => a - b)[0];
    if (lowest !== undefined) {
      this.setMinimumSeverity(lowest);
    }
  }

  debug(message: unknown, meta?: LogMeta | string): void {
    this.emit('debug', message, meta);
  }

  verbose(message: unknown, meta?: LogMeta | string): void {
    this.emit('verbose', message, meta);
  }

  log(message: unknown, meta?: LogMeta | string): void {
    this.emit('log', message, meta);
  }

  warn(message: unknown, meta?: LogMeta | string): void {
    this.emit('warn', message, meta);
  }

  error(message: unknown, stackOrMeta?: LogMeta | string, maybeContext?: string): void {
    this.emit('error', message, stackOrMeta, maybeContext);
  }

  fatal(message: unknown, stackOrMeta?: LogMeta | string, maybeContext?: string): void {
    this.emit('fatal', message, stackOrMeta, maybeContext);
  }

  private setMinimumSeverity(severity: number): void {
    this.minimumSeverity = severity;
  }

  private emit(
    level: StructuredLogLevel,
    message: unknown,
    metaOrStack?: LogMeta | string,
    maybeContext?: string,
  ): void {
    if (LEVEL_SEVERITY[level] < this.minimumSeverity) {
      return;
    }

    const store = RequestContext.get();
    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message: this.formatMessage(message),
    };

    // NestJS's built-in call shape is `logger.error(message, stack, context)`.
    let context = maybeContext ?? this.context;
    if (typeof metaOrStack === 'string') {
      if (level === 'error' || level === 'fatal') {
        record.stack = redactString(metaOrStack);
      } else {
        context = metaOrStack;
      }
    } else if (metaOrStack !== undefined) {
      const redacted = redactObject(metaOrStack) ?? {};
      for (const [key, value] of Object.entries(redacted)) {
        if (!(key in record)) {
          record[key] = value;
        }
      }
    }

    if (context !== undefined) {
      record.context = context;
    }
    if (store !== undefined) {
      record.traceId = store.traceId;
      if (store.userId !== undefined) {
        record.userId = store.userId;
      }
      if (store.method !== undefined) {
        record.method = store.method;
      }
      if (store.path !== undefined) {
        record.path = redactString(store.path);
      }
    }

    if (message instanceof Error && record.stack === undefined && message.stack !== undefined) {
      record.stack = redactString(message.stack);
    }

    this.writer.write(this.serialise(record));
  }

  private formatMessage(message: unknown): string {
    if (typeof message === 'string') {
      return redactString(message);
    }
    if (message instanceof Error) {
      return redactString(message.message);
    }
    const redacted = redact(message);
    return typeof redacted === 'string' ? redacted : this.serialise(redacted);
  }

  private serialise(value: unknown): string {
    try {
      return JSON.stringify(value, undefined, this.pretty ? 2 : undefined) ?? '""';
    } catch {
      return JSON.stringify({ level: 'error', message: '[UNSERIALISABLE_LOG_RECORD]' });
    }
  }
}

export const rootLogger = new StructuredLoggerService({ context: 'Bootstrap' });
