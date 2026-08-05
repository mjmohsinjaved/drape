import { ApiProperty } from '@nestjs/swagger';

import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * How many renders one archive may carry.
 *
 * C-5 gives a consumer fifteen generations a month, so a selection larger than this is
 * not a selection — it is "everything", and everything is what C-39's account data
 * export is for (`POST /me/data/export`). Keeping the ceiling here low also keeps the
 * response a download rather than a background job: twenty-five renders is a few
 * seconds of watermarking, streamed out as it goes.
 */
export const MAX_DOWNLOAD_RESULTS = 25;

/**
 * `POST /results/download` — ARCHITECTURE §5.12, PRD C-23.
 *
 * A POST for a read because the selection is a body: a dozen uuids on a query string
 * is a URL that proxies truncate and access logs keep.
 *
 * Every id is ownership-checked individually against the caller, and an id belonging
 * to somebody else is refused with the same `RESULT_NOT_FOUND` a nonexistent one gets
 * (§2.4, §9.2) — the response must not become an oracle for which render ids exist.
 */
export class ResultDownloadDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: MAX_DOWNLOAD_RESULTS,
    description: 'The renders to archive. Yours only; deduplicated; bounded.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_DOWNLOAD_RESULTS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  resultIds: string[];
}
