import { ApiProperty } from '@nestjs/swagger';

/**
 * One of her share links — `GET /share-links`, `POST /share-links` (C-34, §5.14).
 *
 * `url` carries the raw token and is therefore returned **only by `POST`**, once, at
 * creation: `share_links.tokenHash` stores a digest, so the API could not reproduce a
 * link later even if a route asked it to. That is the same construction the invite and
 * password-reset tokens use, and it is why a database disclosure leaks no working link.
 */
export class ShareLinkResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true, example: 'Ammi', description: 'Her own name for the link.' })
  label: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'The full link, including the token. Present only in the response that created ' +
      'it — the token is stored hashed and cannot be shown again.',
  })
  url: string | null;

  @ApiProperty({ description: 'Created at now + 30 days (C-34).' })
  expiresAt: Date;

  @ApiProperty({ nullable: true })
  revokedAt: Date | null;

  @ApiProperty({
    description: 'True while the link still opens: not revoked, not past its expiry.',
  })
  active: boolean;

  @ApiProperty({ example: 12 })
  viewCount: number;

  @ApiProperty({ nullable: true })
  lastViewedAt: Date | null;

  @ApiProperty({ example: 4, description: 'How many reactions recipients have left.' })
  voteCount: number;

  @ApiProperty()
  createdAt: Date;
}
