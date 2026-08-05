import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { QUALITY_CHECKS, QUALITY_VERDICTS } from '../validators/image-quality.constants';

/** One A-10 check, as the admin console renders it. */
export class ImageQualityCheckDto {
  @ApiProperty({ enum: Object.values(QUALITY_CHECKS), enumName: 'QualityCheckId' })
  check: string;

  @ApiProperty()
  passed: boolean;

  @ApiProperty({ description: 'This check’s contribution to the 0–100 score.' })
  score: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'What to do next. Present only when the check failed (PRD §10.5, D-7).',
    example: 'Re-export this piece at 2,000px or more on its longest side. This one is 1,640px.',
  })
  remediation: string | null;
}

/**
 * The A-10 verdict for a try-on source (§5.7, §4.13).
 *
 * `needsBetterPhoto` and `label` are the same fact twice, on purpose: the boolean is what the
 * console branches on, and the label is A-10's own words, served from the API so the web app
 * cannot drift into calling it something else.
 */
export class ImageQualityReportDto {
  @ApiProperty({ minimum: 0, maximum: 100, description: 'Persisted as `garments.qualityScore`.' })
  score: number;

  @ApiProperty({ description: 'The pass mark this was judged against — `quality.minScore`.' })
  minScore: number;

  @ApiProperty({ description: '`score >= minScore`. Publishing below this needs an override.' })
  passed: boolean;

  @ApiProperty({ enum: Object.values(QUALITY_VERDICTS), enumName: 'QualityVerdict' })
  verdict: string;

  @ApiProperty({ description: 'True when the garment is marked "Needs a better photo" (A-10).' })
  needsBetterPhoto: boolean;

  @ApiProperty({ example: 'Needs a better photo', description: 'A-10’s label, word for word.' })
  label: string;

  @ApiProperty({ type: [ImageQualityCheckDto] })
  checks: ImageQualityCheckDto[];
}
