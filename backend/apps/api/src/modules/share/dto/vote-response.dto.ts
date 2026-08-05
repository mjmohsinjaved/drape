import { ApiProperty } from '@nestjs/swagger';

import { Reaction } from '../enums/reaction.enum';

/**
 * A reaction, as its own author sees it — `GET`/`POST /share/:token/votes`.
 *
 * §5.14 wants a recipient to see "reactions already left under this link, so a
 * recipient sees their own". **Their own**, and no more: the share-link-comment email
 * tells the owner that "the people you shared with cannot see each other's notes", and
 * this DTO is where that promise is kept. `PublicShareService` filters by the caller's
 * own fingerprint before a row ever reaches this shape.
 */
export class VoteResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  garmentId: string;

  @ApiProperty({ enum: Reaction })
  reaction: Reaction;

  @ApiProperty({ nullable: true })
  comment: string | null;

  @ApiProperty()
  createdAt: Date;
}

/**
 * A reaction as the **owner** sees it — `GET /share-links/:shareLinkId/votes`.
 *
 * She sees every reaction left under her own link, and the label each visitor typed,
 * because that is the whole point of having shared it. There is no fingerprint on this
 * DTO: it is a hash of a cookie in someone else's browser, it identifies nobody
 * usefully, and it has no business crossing the wire.
 */
export class ShareLinkVoteDto extends VoteResponseDto {
  @ApiProperty({ example: 'Ammi', description: 'The name the visitor typed.' })
  voterLabel: string;

  @ApiProperty({ example: 'Zarrin Bridal Lehenga' })
  garmentTitle: string;
}
