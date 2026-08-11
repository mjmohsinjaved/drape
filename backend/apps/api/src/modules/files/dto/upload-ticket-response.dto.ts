import { ApiProperty } from '@nestjs/swagger';

import { UploadPurpose } from '../enums/upload-purpose.enum';

/**
 * The `UploadTicket` of ARCHITECTURE §3.1, as it reaches the client.
 *
 * ### Why this one response carries a storage key
 *
 * §3.4 is categorical: "a storage key must never cross the network boundary". This DTO is the
 * single documented exception, and it is not really an exception at all — `key` here names an
 * object that **does not exist yet**, it is already bound into the HMAC of `uploadUrl`, and
 * §3.5 step 3 requires the client to hand it back to the owning module's finalise endpoint.
 * Nothing can be read with it: every read goes through a signed download token, and the
 * finalise endpoints re-verify that the object exists under the prefix they expect.
 */
export class UploadTicketResponseDto {
  @ApiProperty({
    description:
      'Where to PUT the bytes. For the local driver this is a route on this API; for a future ' +
      'S3 driver it is the bucket. `isDirect` says which. Carries no credential — see `ticket`.',
    example: 'http://localhost:4000/api/v1/files/upload',
  })
  uploadUrl: string;

  @ApiProperty({
    description:
      'The signed credential. Send it in the `X-Upload-Ticket` request header of the PUT — ' +
      'never in the URL (§3.5 step 2).',
    example: 'eyJrZXkiOi….xlJ10v5c…',
  })
  ticket: string;

  @ApiProperty({
    description: 'The key the object will occupy. Hand it to the owning finalise endpoint.',
    example:
      'garments/6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c/0c0a1b2c-3d4e-4f50-8a6b-7c8d9e0f1a2b.jpg',
  })
  key: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description: 'Extra form fields the client must send. Empty for the local driver.',
  })
  fields: Record<string, string>;

  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;

  @ApiProperty({
    description: 'true when the bytes bypass this API and go straight to the bucket.',
  })
  isDirect: boolean;

  @ApiProperty({ enum: UploadPurpose, enumName: 'UploadPurpose' })
  purpose: UploadPurpose;

  @ApiProperty({ description: 'The ceiling the redemption enforces while streaming.' })
  maxBytes: number;

  @ApiProperty({ example: 'image/jpeg', description: 'The type the magic bytes must match.' })
  contentType: string;
}

export class UploadResultResponseDto {
  @ApiProperty({ description: 'Hand this to the owning module’s finalise endpoint.' })
  key: string;

  @ApiProperty({ description: 'Bytes actually written, measured by the server as it wrote them.' })
  byteSize: number;

  @ApiProperty({ example: 'image/jpeg', description: 'Resolved from the magic bytes.' })
  contentType: string;
}
