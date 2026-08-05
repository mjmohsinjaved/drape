import { MILLISECONDS_PER_DAY } from '@library/common';

/**
 * The numbers behind a share link — PRD C-33, C-34, ARCHITECTURE §4.21, §4.22.
 */

/**
 * C-34: "Share links … expire after 30 days."
 *
 * Not configurable. An admin-tunable expiry would mean the privacy promise made to a
 * consumer on the day she shared could be lengthened afterwards without her.
 */
export const SHARE_LINK_TTL_DAYS = 30;

/** Milliseconds in a day, for the expiry arithmetic — `@library/common`'s, re-exported. */
export { MILLISECONDS_PER_DAY };

/**
 * 32 bytes — 256 bits — of CSPRNG output per token, base64url encoded to 43
 * characters.
 *
 * The token is a bearer credential with no second factor behind it: whoever holds it
 * sees the renders. So it is sized against offline guessing rather than against
 * "looks long enough", and `share_links.tokenHash` stores only its sha256 — a database
 * disclosure leaks no working link.
 */
export const SHARE_TOKEN_BYTES = 32;

/**
 * How many live links one consumer may hold at a time.
 *
 * "Ammi", "Sisters", "the girls" — a handful. The cap exists so a compromised session
 * cannot mint an unbounded set of bearer URLs faster than she could revoke them.
 */
export const MAX_ACTIVE_SHARE_LINKS = 20;

/** `share_links.label` — `varchar(60)` in §4.21. Her own name for the link. */
export const MAX_SHARE_LABEL_LENGTH = 60;

/** `votes.voterLabel` — `varchar(60)` in §4.22. The name the visitor typed. */
export const MAX_VOTER_LABEL_LENGTH = 60;

/** One comment per item, and a comment is a sentence, not an essay (C-33). */
export const MAX_VOTE_COMMENT_LENGTH = 500;

/**
 * The first-party cookie that identifies a returning visitor.
 *
 * §4.22 stores the **sha256** of this value in `votes.voterFingerprint`; the raw value
 * never leaves the visitor's browser and is never stored. It is not an account and it
 * is not authentication — C-33 requires "no account from recipients". It exists so a
 * visitor sees the reactions they already left, and so a second comment on the same
 * piece can be refused.
 */
export const VOTER_COOKIE_NAME = 'drape.voter';

/** The voter cookie outlives the link it was minted for, so a returning visitor is recognised. */
export const VOTER_COOKIE_MAX_AGE_MS = (SHARE_LINK_TTL_DAYS + 1) * MILLISECONDS_PER_DAY;

/**
 * How long a signed URL for a share-page thumbnail lives — **five minutes**.
 *
 * `thumbnails/render/**` is a public object class, so these used to fall to
 * `STORAGE_URL_TTL_PUBLIC_SECONDS` — an hour — and `FileDownloadService` serves a
 * subject-less object with `Cache-Control: public`. Combined with the two-minute issue
 * bucket that makes the URL a stable shared-cache key, revoking a link left an hour of
 * working image URLs in every proxy between here and the recipient. C-34 promises the
 * link is "revocable at any time"; that was true of the page and false of the pictures.
 *
 * `ShareAudienceValidator` is the real control — it refuses a revoked link on the very
 * next request. This TTL bounds the one case a server-side check cannot reach: bytes
 * already cached. Five minutes is long enough that scrolling the page does not re-fetch
 * every image and short enough that a revocation is effective in minutes rather than in
 * an hour.
 */
export const SHARE_THUMBNAIL_URL_TTL_SECONDS = 300;
