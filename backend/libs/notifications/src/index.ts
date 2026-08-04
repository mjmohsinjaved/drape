/**
 * `@library/notifications` — the public surface.
 *
 * Import from this barrel only (docs/ARCHITECTURE.md §1.1); deep paths are banned by ESLint.
 */
export * from './notifications.config';
export * from './notifications.constants';
export * from './notifications.module';
export * from './notifications.service';

export * from './exceptions/notification.exception';
export * from './interfaces';
export * from './providers';
export * from './templates';
export * from './utils';
