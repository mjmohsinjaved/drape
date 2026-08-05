import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One store address (A-27). */
export class BrandAddressDto {
  @ApiProperty({ example: 'Gulberg Flagship' })
  label: string;

  @ApiProperty({ example: '12-C Main Boulevard, Gulberg III' })
  address: string;

  @ApiPropertyOptional({ example: 'Lahore' })
  city?: string;

  @ApiPropertyOptional({ example: '+924235000000' })
  phone?: string;

  @ApiPropertyOptional({ example: 'https://maps.example.com/?q=…' })
  mapUrl?: string;
}

/**
 * `GET /settings/brand` — the **public** projection (A-27, A-30, §5.4).
 *
 * Built by walking `SETTINGS_REGISTRY.filter(isPublic)`, never by listing keys here,
 * so a key that is not marked public has no route into this shape. `settings.mapper`
 * refuses to build the response if the registry gains a public key it does not know
 * how to project, and a unit test walks the registry to prove no private key leaks.
 *
 * Note `logoUrl`, not `logoKey`: the storage key never crosses the wire (§3.4, E-12).
 * The consumer gets a signed, expiring URL.
 */
export class BrandSettingsResponseDto {
  @ApiProperty({ example: 'Drape' })
  name: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Signed, expiring URL for the brand logo. Null until one is uploaded.',
  })
  logoUrl: string | null;

  @ApiProperty({ example: '#71202F' })
  primaryColor: string;

  @ApiPropertyOptional({ nullable: true, example: '+923001234567' })
  whatsappNumber: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'drape.studio' })
  instagramHandle: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'hello@example.com' })
  contactEmail: string | null;

  @ApiProperty({ type: [BrandAddressDto] })
  storeAddresses: BrandAddressDto[];

  @ApiProperty({ description: 'A-30 — show prices to signed-out visitors and on share links.' })
  showPricesPublicly: boolean;

  @ApiProperty({ description: 'A-30 — master switch for share links and voting.' })
  sharingEnabled: boolean;

  @ApiProperty({ description: 'A-30 — master switch for enquiry submission.' })
  enquiriesEnabled: boolean;

  @ApiProperty({ example: 'drape', description: 'A-32 — the in-store QR / bio-link slug.' })
  shortLinkSlug: string;
}
