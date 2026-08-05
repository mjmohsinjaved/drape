import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { randomToken, sha256Hex } from '@library/common';

import {
  SHARE_TOKEN_BYTES,
  VOTER_COOKIE_MAX_AGE_MS,
  VOTER_COOKIE_NAME,
} from '../constants/share.constants';

/** The cookie attributes the visitor cookie is written with. */
export interface VoterCookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge: number;
}

/** A raw token and its digest. The raw value exists only long enough to be returned once. */
export interface IssuedShareToken {
  /** Returned to the owner in the creating response, and never again. */
  readonly raw: string;
  /** What `share_links.tokenHash` stores — `char(64)`, §4.21. */
  readonly hash: string;
}

/**
 * Share-link tokens and voter fingerprints — PRD C-33, C-34, §9.2, ARCHITECTURE §4.21, §4.22.
 *
 * ### Why the token is hashed at rest
 *
 * A share token is a **bearer credential**: whoever holds the URL sees the renders,
 * with no session and no second factor behind it. Stored in the clear, a read of
 * `share_links` — a backup, a support query, a log line — would be a working link to
 * every consumer's shortlist. Stored as sha256, that same read yields nothing usable.
 * It is the same construction the invite and password-reset tokens already use.
 *
 * sha256 without a salt or a work factor is right here and wrong for a password: the
 * input is 256 bits of CSPRNG output, so there is no dictionary to attack and no
 * benefit to slowing a lookup that has to happen on every page view.
 *
 * ### Why the voter fingerprint is hashed too
 *
 * §4.22 stores "sha256 of a first-party cookie value". The raw cookie stays in the
 * visitor's browser. What the database holds cannot be replayed as a cookie, and it
 * identifies nobody outside the one link it was used on.
 */
@Injectable()
export class ShareTokenService {
  constructor(private readonly config: ConfigService) {}

  /** Mints a token. 256 bits from the CSPRNG, base64url encoded. */
  issue(): IssuedShareToken {
    const raw = randomToken(SHARE_TOKEN_BYTES);
    return { raw, hash: sha256Hex(raw) };
  }

  /** The digest a presented token should be looked up by. */
  hash(rawToken: string): string {
    return sha256Hex(rawToken);
  }

  /** A fresh voter cookie value. Never stored — only its digest is (§4.22). */
  issueVoterToken(): string {
    return randomToken(SHARE_TOKEN_BYTES);
  }

  /** `votes.voterFingerprint` for a presented cookie value. */
  fingerprint(voterToken: string): string {
    return sha256Hex(voterToken);
  }

  /** The name of the first-party cookie carrying the voter token. */
  get voterCookieName(): string {
    return VOTER_COOKIE_NAME;
  }

  /**
   * How the visitor cookie is written.
   *
   * `httpOnly` because no script on the share page needs to read it, and `sameSite:
   * 'lax'` because arriving from WhatsApp is a top-level navigation that `strict`
   * would strip the cookie from. `secure` follows `SESSION_COOKIE_SECURE` rather than
   * being hard-coded either way: §7 already forces that variable true outside local
   * development, so this cookie inherits the same rule as the session cookie instead
   * of inventing a second, quieter one.
   */
  voterCookieOptions(): VoterCookieOptions {
    return {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('SESSION_COOKIE_SECURE'),
      sameSite: 'lax',
      path: '/',
      maxAge: VOTER_COOKIE_MAX_AGE_MS,
    };
  }

  /**
   * The URL a recipient opens.
   *
   * `getOrThrow` because §7 marks `APP_WEB_URL` required: a share link pointing at
   * `undefined/share/…` is worse than a boot failure, because it is discovered by the
   * consumer's family rather than by the deploy.
   */
  urlFor(rawToken: string): string {
    const webUrl = this.config.getOrThrow<string>('APP_WEB_URL').replace(/\/+$/, '');
    return `${webUrl}/share/${encodeURIComponent(rawToken)}`;
  }
}
