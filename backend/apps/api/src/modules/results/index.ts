/**
 * The `results` module's public surface.
 *
 * `tryon` takes `ResultWriterService` — the write path, and nothing else. `enquiries`
 * and `share` take `ResultsService` to project a render the consumer chose to attach.
 * Nothing outside this module constructs a `tryon_results` row by hand: the snapshot
 * columns are what make C-28 and C-29 work, and a row written without them is a blank
 * line in someone's history the day a garment is deleted.
 */
export { ResultsModule } from './results.module';
export {
  ResultWriterService,
  RENDER_THUMBNAIL_WIDTH,
  type PersistResultInput,
  type StoredRender,
} from './services/result-writer.service';
export { ResultsService } from './services/results.service';
export { ResultDownloadService, type WatermarkedRender } from './services/result-download.service';
export { MarketingOptInDto } from './dto/marketing-opt-in.dto';
export { ResultIdParamDto } from './dto/result-id-param.dto';
export { RESULT_SORT_KEYS, ResultQueryDto, type ResultSortKey } from './dto/result-query.dto';
export { ResultGroupDto, ResultResponseDto } from './dto/result-response.dto';
export { toResultResponse, type SignRenderUrl } from './mappers/result.mapper';
