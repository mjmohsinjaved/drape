import { Injectable, Logger } from '@nestjs/common';

/**
 * Answers "is the credential named by this `aud` claim still live?" for one scheme.
 *
 * Implemented by whichever module owns the credential — `share` owns `share-link`, and
 * only `share` can read `share_links`.
 */
export interface SignedUrlAudienceValidator {
  /**
   * @param id the part of the `aud` claim after the scheme.
   * @returns `true` only when the credential exists and has not been revoked or expired.
   *   Implementations must never throw: a validator that throws is treated as a refusal.
   */
  isAudienceLive(id: string): Promise<boolean>;
}

/** `<scheme>:<id>` — the only `aud` shape this registry understands. */
export interface ParsedAudience {
  readonly scheme: string;
  readonly id: string;
}

/**
 * **How a signed URL handed to somebody with no session stops working when the thing
 * that authorised it is revoked.**
 *
 * ### The gap this closes
 *
 * `sub` binds a download token to a session, and `GET /files/:token` compares it against
 * the caller's own id. That is the whole of §3.4's answer for private objects, and it
 * works because the reader has an account.
 *
 * A share-page thumbnail has no such reader. C-33 gives the recipient a link and nothing
 * else — no session, no `sub` to match — so the thumbnail is signed subject-less and, up
 * to now, was simply a bearer URL with the *public* one-hour TTL. C-34 promises the owner
 * her link is "revocable at any time"; revocation removed the page, but every image URL
 * already handed out kept working until its own expiry, and with the two-minute issue
 * bucket those URLs are stable enough to be a shared-cache key. Revocation was therefore
 * effective for the page and ineffective for the pictures on it.
 *
 * `aud` fixes the binding. The token carries `share-link:<uuid>`; the download route asks
 * this registry whether that link is still live; a revoked link fails the check on the
 * very next request. The short TTL that also went on those URLs bounds the damage from a
 * *cached* copy — the two are complementary, and neither replaces the other.
 *
 * ### Why a registry rather than an injected dependency
 *
 * `modules/files` is the byte choke point every other module depends on. Making it import
 * `ShareModule` to type-check a claim would invert the dependency that makes the storage
 * guarantees checkable — and it would do so again for every future credential class.
 *
 * `StorageModule` is `@Global()`, so this registry is reachable from both sides without
 * either module knowing about the other: `ShareModule` registers a validator at init,
 * `FileDownloadService` asks. The module graph is unchanged.
 *
 * ### Fail closed
 *
 * An `aud` claim naming a scheme nobody registered is **refused**, not ignored. The
 * alternative — treating an unrecognised claim as absent — would mean that failing to
 * wire a validator silently downgrades every token of that class back to a plain bearer
 * URL, which is precisely the bug this exists to prevent and would be invisible.
 */
@Injectable()
export class SignedUrlAudienceRegistry {
  private readonly logger = new Logger(SignedUrlAudienceRegistry.name);

  private readonly validators = new Map<string, SignedUrlAudienceValidator>();

  /**
   * Claims a scheme. Called once, from the owning module's `onModuleInit`.
   *
   * A second registration for the same scheme replaces the first and is logged: in a
   * running application it means two modules believe they own one credential class, which
   * is worth hearing about, and in a test it is a re-created module and entirely normal.
   */
  register(scheme: string, validator: SignedUrlAudienceValidator): void {
    if (this.validators.has(scheme)) {
      this.logger.debug(`The "${scheme}" audience validator was replaced.`);
    }
    this.validators.set(scheme, validator);
  }

  /** Builds the claim a token carries. The one place the `<scheme>:<id>` shape is written. */
  static audience(scheme: string, id: string): string {
    return `${scheme}:${id}`;
  }

  /**
   * `true` only when the claim parses, its scheme has a validator, and that validator
   * says the credential is still live. Everything else — an unparseable claim, an
   * unregistered scheme, a validator that threw — is `false`.
   */
  async isLive(audience: string): Promise<boolean> {
    const parsed = parseAudience(audience);
    if (parsed === null) {
      return false;
    }

    const validator = this.validators.get(parsed.scheme);
    if (validator === undefined) {
      this.logger.warn(
        `A signed URL carried the audience scheme "${parsed.scheme}", which no module has ` +
          'registered a validator for. The read is refused.',
      );
      return false;
    }

    try {
      return await validator.isAudienceLive(parsed.id);
    } catch (error: unknown) {
      this.logger.error(
        `The "${parsed.scheme}" audience validator failed; the read is refused. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}

/** `<scheme>:<id>`, where neither half may be empty and the scheme carries no colon. */
export function parseAudience(audience: string): ParsedAudience | null {
  const separator = audience.indexOf(':');
  if (separator <= 0 || separator === audience.length - 1) {
    return null;
  }
  return { scheme: audience.slice(0, separator), id: audience.slice(separator + 1) };
}
