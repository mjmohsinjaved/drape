/**
 * The `share` module's public surface.
 *
 * Nothing that could widen the recipient view is exported. `PublicShareService` is
 * deliberately absent: it exists to serve two `@Public()` routes, and a module that
 * called it would be asking for a projection built for people with no account.
 *
 * The scope helpers are exported for one reason — so a test elsewhere can assert the
 * exclusions, and so anybody reading `enquiries` or `analytics` can see what the
 * public share query is allowed to touch without opening this module.
 */
export { ShareModule } from './share.module';
export { ShareLinksService } from './services/share-links.service';
export { ShareTokenService, type IssuedShareToken } from './services/share-token.service';
export {
  FORBIDDEN_SHARE_FRAGMENTS,
  publicShareScope,
  SHARED_CATEGORY_ALIAS,
  SHARED_GARMENT_ALIAS,
  SHARED_ITEM_ALIAS,
  SHARED_RENDER_ALIAS,
  type SharedShortlistRow,
} from './queries/public-share.scope';
export {
  SHARE_COMMENT_LEFT_EVENT,
  ShareCommentLeftEvent,
  type ShareCommentLeftInput,
} from './events/share.events';
export {
  MAX_ACTIVE_SHARE_LINKS,
  MAX_VOTE_COMMENT_LENGTH,
  MAX_VOTER_LABEL_LENGTH,
  SHARE_LINK_TTL_DAYS,
  SHARE_TOKEN_BYTES,
  VOTER_COOKIE_NAME,
} from './constants/share.constants';
export { CastVoteDto } from './dto/cast-vote.dto';
export { CreateShareLinkDto } from './dto/create-share-link.dto';
export { ShareLinkParamDto, ShareTokenParamDto } from './dto/share-params.dto';
export { ShareLinkResponseDto } from './dto/share-link-response.dto';
export { SharedGarmentDto, SharedShortlistResponseDto } from './dto/shared-shortlist-response.dto';
export { ShareLinkVoteDto, VoteResponseDto } from './dto/vote-response.dto';
export { isLinkActive, toShareLinkResponse, toSharedGarment } from './mappers/share.mapper';
