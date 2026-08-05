import { ApiProperty } from '@nestjs/swagger';

/** `GET /settings/short-link` — the copyable Instagram-bio link (A-32). */
export class ShortLinkResponseDto {
  @ApiProperty({ example: 'drape', description: 'The `shortLink.slug` setting.' })
  slug: string;

  @ApiProperty({
    example: 'https://app.example.com/drape',
    description: 'The link to paste into the Instagram bio. Built from APP_WEB_URL.',
  })
  url: string;
}

/**
 * `GET /settings/qr` — the in-store signage QR code (A-32).
 *
 * Returned as a `data:` URL rather than a binary stream so it stays inside the §2.3
 * envelope: the admin screen renders it in an `<img>`, and printing it is a
 * right-click, with no second authenticated request and no file to leave lying about.
 */
export class QrCodeResponseDto {
  @ApiProperty({ example: 'drape' })
  slug: string;

  @ApiProperty({ example: 'https://app.example.com/drape', description: 'What the QR encodes.' })
  targetUrl: string;

  @ApiProperty({
    description: 'PNG, base64, as a data URL.',
    example: 'data:image/png;base64,iVBORw0KGgo…',
  })
  dataUrl: string;
}
