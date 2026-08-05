import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Locale } from '@api/modules/users/enums/locale.enum';

/**
 * `GET /me/data` — PRD C-37, ARCHITECTURE §5.2.
 *
 * > "A single screen showing everything stored about her: profile, photos, renders,
 * > shortlists, enquiries, and the consent she granted with its date."
 *
 * ### One screen, and what that costs
 *
 * "A single screen" is the requirement, so every list here is capped
 * ({@link MY_DATA_PAGE_SIZE}) and carries its own true total beside it. A consumer with
 * four hundred renders sees a hundred and is told there are four hundred; the export
 * (C-39) is where she gets all of them. Returning everything would turn a privacy screen
 * into the slowest page in the product and give her a wall of JSON instead of an answer.
 *
 * ### These are her own records, so they carry her own URLs
 *
 * `photos[].url` and `renders[].url` are signed and scoped to **her** id (§3.4). This is
 * the exact inverse of the moderation queue: there, an admin gets a blurred derivative
 * because the photograph is not hers; here, she gets the original because it is.
 */
export class MyDataProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ayesha Khan' })
  name: string;

  @ApiProperty({ example: 'ayesha@example.com' })
  email: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '+923001234567' })
  phone: string | null;

  @ApiProperty({ enum: Locale, enumName: 'Locale' })
  locale: Locale;

  @ApiProperty({ format: 'date-time', description: 'When she signed up.' })
  createdAt: Date;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  emailVerifiedAt: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  phoneVerifiedAt: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  lastActiveAt: Date | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Set once she has asked for deletion (C-38). Null otherwise.',
  })
  deletionRequestedAt: Date | null;
}

/** One of her photographs (C-16, C-37). */
export class MyDataPhotoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'daylight' })
  label: string | null;

  @ApiProperty({ example: true, description: 'The one her try-ons run against (C-16).' })
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  uploadedAt: Date;

  @ApiProperty({
    format: 'date-time',
    description: '§9.3 — when it is deleted if she does not return before then.',
  })
  purgeAfter: Date;

  @ApiProperty({ description: 'Signed and scoped to her own id (§3.4). Hers to see.' })
  url: string;
}

/** One of her renders (C-27, C-37). */
export class MyDataRenderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    example: 'Anarkali in ivory',
    description: 'Snapshot — survives the garment (C-29).',
  })
  garmentTitle: string;

  @ApiProperty({ example: 'Bridal' })
  garmentCategory: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: '§9.3 — per-render marketing opt-in. Null means she has not granted one.',
  })
  marketingOptInAt: Date | null;

  @ApiProperty({ description: 'Signed and scoped to her own id (§3.4).' })
  url: string;
}

/** One shortlist entry, including the `NOT_FOR_ME` ones she may have forgotten about. */
export class MyDataShortlistItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'LOVE_IT', description: '`LOVE_IT`, `MAYBE` or `NOT_FOR_ME` (§4.20).' })
  verdict: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'TOO_HEAVY' })
  rejectReason: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  verdictAt: Date;
}

/** One enquiry she sent (C-35, C-37). */
export class MyDataEnquiryDto {
  @ApiProperty({ example: 'ENQ-2026-000137' })
  reference: string;

  @ApiProperty({ example: 'NEW' })
  status: string;

  @ApiProperty({ example: 3 })
  itemCount: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}

/** One share link she created (C-33, C-34). */
export class MyDataShareLinkDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Ammi' })
  label: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  revokedAt: Date | null;

  @ApiProperty({ example: 12 })
  viewCount: number;
}

/**
 * The consent she granted, with its date — C-37 names this explicitly.
 *
 * `consents` is append-only (§4.11), so what is shown is the **current** grant: the
 * most recent row, with the policy version it was given against. `ip` and `userAgent`
 * are on the row and are deliberately not on this DTO — they are evidence for the
 * studio's records, not information she asked for, and putting an IP address on a
 * privacy screen would be a strange thing to do on a privacy screen.
 */
export class MyDataConsentDto {
  @ApiProperty({ example: 'v2.1', description: 'The policy version she agreed to.' })
  policyVersion: string;

  @ApiProperty({ format: 'date-time', description: 'When she granted it (C-11, C-37).' })
  grantedAt: Date;

  @ApiProperty({ enum: Locale, enumName: 'Locale', description: 'Which translation she read.' })
  locale: Locale;

  @ApiProperty({
    example: true,
    description: 'False when the policy has moved on since — `CONSENT_STALE` (C-12).',
  })
  current: boolean;
}

/** A capped list with its true total beside it. */
export class MyDataSectionDto<T> {
  @ApiProperty({ example: 412, description: 'How many she has in total.' })
  total: number;

  @ApiProperty({ example: 100, description: 'How many are shown here. The export has them all.' })
  shown: number;

  items: T[];
}

/** `GET /me/data` (C-37, §5.2). */
export class MyDataResponseDto {
  @ApiProperty({ type: MyDataProfileDto })
  profile: MyDataProfileDto;

  @ApiProperty({ type: [MyDataPhotoDto] })
  photos: MyDataSectionDto<MyDataPhotoDto>;

  @ApiProperty({ type: [MyDataRenderDto] })
  renders: MyDataSectionDto<MyDataRenderDto>;

  @ApiProperty({ type: [MyDataShortlistItemDto] })
  shortlist: MyDataSectionDto<MyDataShortlistItemDto>;

  @ApiProperty({ type: [MyDataEnquiryDto] })
  enquiries: MyDataSectionDto<MyDataEnquiryDto>;

  @ApiProperty({ type: [MyDataShareLinkDto] })
  shareLinks: MyDataSectionDto<MyDataShareLinkDto>;

  @ApiPropertyOptional({
    type: MyDataConsentDto,
    nullable: true,
    description: 'Her current consent, or null if she has somehow never granted one.',
  })
  consent: MyDataConsentDto | null;

  @ApiProperty({
    format: 'date-time',
    description: 'When this snapshot was taken. It is a live read, not a stored copy.',
  })
  generatedAt: Date;
}
