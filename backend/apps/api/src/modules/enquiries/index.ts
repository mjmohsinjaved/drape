/**
 * The `enquiries` module's public surface.
 *
 * `analytics` takes the two services for the A-1 tiles and the A-36 funnel. The status
 * machine is exported because it is the contract — anything that needs to know whether
 * an enquiry can still move should ask it rather than re-deriving the answer from a
 * status column, which is how two parts of a product come to disagree about what
 * "closed" means.
 *
 * Nothing that writes a status is exported. There is one entrance to that machine and
 * it is `PATCH /admin/enquiries/:enquiryId/status`.
 */
export { EnquiriesModule } from './enquiries.module';
export { EnquiriesService } from './services/enquiries.service';
export { AdminEnquiriesService } from './services/admin-enquiries.service';
export { EnquiryExportService, type CsvSink } from './services/enquiry-export.service';
export { WhatsAppReplyService } from './services/whatsapp-reply.service';
export {
  assertEnquiryTransition,
  CLOSED_ENQUIRY_STATUSES,
  ENQUIRY_TRANSITIONS,
  isAllowedEnquiryTransition,
  isClosedEnquiryStatus,
} from './state/enquiry-status.machine';
export {
  ADMIN_ENQUIRY_ITEM_ALIAS,
  ADMIN_ENQUIRY_RENDER_ALIAS,
  adminEnquiryRendersScope,
  FORBIDDEN_ADMIN_RENDER_FRAGMENTS,
  loadAdminRenders,
  type AdminRenderRow,
} from './queries/admin-enquiry.scope';
export {
  ENQUIRY_CREATED_EVENT,
  ENQUIRY_STATUS_CHANGED_EVENT,
  EnquiryCreatedEvent,
  EnquiryStatusChangedEvent,
  type EnquiryCreatedInput,
  type EnquiryStatusChangedInput,
} from './events/enquiry.events';
export {
  ENQUIRY_STALE_AFTER_HOURS,
  MAX_ENQUIRY_MESSAGE_LENGTH,
  MAX_ENQUIRY_NOTE_LENGTH,
  MAX_LOST_REASON_LENGTH,
  WHATSAPP_TOP_PIECES,
} from './constants/enquiry.constants';
export { CreateEnquiryDto } from './dto/create-enquiry.dto';
export { EnquiryIdParamDto } from './dto/enquiry-params.dto';
export {
  AdminEnquiryQueryDto,
  ENQUIRY_SORT_KEYS,
  EnquiryQueryDto,
  type EnquirySortKey,
} from './dto/enquiry-query.dto';
export {
  AdminEnquiryItemDto,
  AdminEnquiryResponseDto,
  AdminEnquirySummaryDto,
  ConsumerEnquiryResponseDto,
  EnquiryItemResponseDto,
  EnquiryNoteResponseDto,
  WhatsAppReplyDto,
} from './dto/enquiry-response.dto';
export {
  AssignEnquiryDto,
  CreateEnquiryNoteDto,
  UpdateEnquiryStatusDto,
} from './dto/update-enquiry.dto';
export {
  isStaleEnquiry,
  toAdminEnquiry,
  toAdminEnquirySummary,
  toConsumerEnquiry,
  toEnquiryNote,
} from './mappers/enquiry.mapper';
export {
  enquiryReferencePrefixFor,
  enquiryReferenceYear,
  formatEnquiryReference,
} from './utils/enquiry-reference';
