/**
 * The `consents` module's public surface.
 *
 * The one export other modules actually need is
 * `ConsentsService.assertConsentIsCurrent()` — steps 4 and 5 of the §8.1 guard chain.
 * Nothing else should reimplement "has she consented at the current version?".
 */
export { ConsentsModule } from './consents.module';
export { ConsentsService, type ConsentRequestContext } from './services/consents.service';
export { PolicyService, type CurrentPolicySummary } from './services/policy.service';
export { ConsentStatus } from './enums/consent-status.enum';
export { ConsentStatusResponseDto } from './dto/consent-status-response.dto';
export {
  PolicyResponseDto,
  PolicyRetentionDto,
  PolicyVersionResponseDto,
} from './dto/policy-response.dto';
