import { ApiProperty } from '@nestjs/swagger';

import { IsUUID } from 'class-validator';

/**
 * The `:itemId` route parameter of every `/shortlist/**` mutation (§5.13).
 *
 * A param DTO rather than `ParseUUIDPipe`, so a malformed id stays inside the §2.3
 * validation envelope instead of returning a bare 400.
 *
 * A valid uuid here proves nothing about who may touch the row. §9.2: object-level
 * ownership is "never inferred from an unguessable ID" — `ShortlistService` re-reads
 * the row and compares `userId` on every single operation.
 */
export class ShortlistItemParamDto {
  @ApiProperty({ format: 'uuid', example: '6f8b1a2c-7d10-4f9e-9a4c-3f2e1d0b9a8c' })
  @IsUUID()
  itemId: string;
}
