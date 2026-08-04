import { NotificationTemplateError } from '../exceptions/notification.exception';

import {
  accountDeletionConfirmedTemplate,
  type AccountDeletionConfirmedProps,
} from './account-deletion-confirmed.template';
import { accountSuspendedTemplate, type AccountSuspendedProps } from './account-suspended.template';
import { adminInviteTemplate, type AdminInviteProps } from './admin-invite.template';
import {
  budgetExhaustedAdminTemplate,
  type BudgetExhaustedAdminProps,
} from './budget-exhausted-admin.template';
import {
  budgetExhaustedConsumerTemplate,
  type BudgetExhaustedConsumerProps,
} from './budget-exhausted-consumer.template';
import { budgetWarning80Template, type BudgetWarning80Props } from './budget-warning-80.template';
import {
  enquiryReceivedConsumerTemplate,
  type EnquiryReceivedConsumerProps,
} from './enquiry-received-consumer.template';
import {
  enquiryStatusChangedTemplate,
  type EnquiryStatusChangedProps,
} from './enquiry-status-changed.template';
import {
  generationFailureRateAlertTemplate,
  type GenerationFailureRateAlertProps,
} from './generation-failure-rate-alert.template';
import {
  moderationBacklogAlertTemplate,
  type ModerationBacklogAlertProps,
} from './moderation-backlog-alert.template';
import { newEnquiryAdminTemplate, type NewEnquiryAdminProps } from './new-enquiry-admin.template';
import { otpSmsTemplate, type OtpSmsProps } from './otp-sms.template';
import { passwordResetTemplate, type PasswordResetProps } from './password-reset.template';
import { purgeJobFailedTemplate, type PurgeJobFailedProps } from './purge-job-failed.template';
import { renderReadyTemplate, type RenderReadyProps } from './render-ready.template';
import {
  shareLinkCommentTemplate,
  type ShareLinkCommentProps,
} from './share-link-comment.template';
import {
  type RenderedTemplate,
  type TemplateContext,
  type TemplateDefinition,
} from './shared/template-context';
import { verifyEmailTemplate, type VerifyEmailProps } from './verify-email.template';

/**
 * The closed template registry.
 *
 * The values are what `notifications_outbox.template` stores (`varchar(80)`, closed registry —
 * docs/ARCHITECTURE.md §4.32), so they follow the UPPER_SNAKE_CASE rule for enum values in §0. The
 * kebab-case names in the brief are the file names.
 */
export enum TemplateId {
  VERIFY_EMAIL = 'VERIFY_EMAIL',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ADMIN_INVITE = 'ADMIN_INVITE',
  OTP_SMS = 'OTP_SMS',
  NEW_ENQUIRY_ADMIN = 'NEW_ENQUIRY_ADMIN',
  ENQUIRY_RECEIVED_CONSUMER = 'ENQUIRY_RECEIVED_CONSUMER',
  ENQUIRY_STATUS_CHANGED = 'ENQUIRY_STATUS_CHANGED',
  BUDGET_WARNING_80 = 'BUDGET_WARNING_80',
  BUDGET_EXHAUSTED_ADMIN = 'BUDGET_EXHAUSTED_ADMIN',
  BUDGET_EXHAUSTED_CONSUMER = 'BUDGET_EXHAUSTED_CONSUMER',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_DELETION_CONFIRMED = 'ACCOUNT_DELETION_CONFIRMED',
  RENDER_READY = 'RENDER_READY',
  SHARE_LINK_COMMENT = 'SHARE_LINK_COMMENT',
  MODERATION_BACKLOG_ALERT = 'MODERATION_BACKLOG_ALERT',
  GENERATION_FAILURE_RATE_ALERT = 'GENERATION_FAILURE_RATE_ALERT',
  PURGE_JOB_FAILED = 'PURGE_JOB_FAILED',
}

/** Template id → its props type. This is what makes `renderTemplate()` type-safe at the call site. */
export interface TemplatePropsMap {
  [TemplateId.VERIFY_EMAIL]: VerifyEmailProps;
  [TemplateId.PASSWORD_RESET]: PasswordResetProps;
  [TemplateId.ADMIN_INVITE]: AdminInviteProps;
  [TemplateId.OTP_SMS]: OtpSmsProps;
  [TemplateId.NEW_ENQUIRY_ADMIN]: NewEnquiryAdminProps;
  [TemplateId.ENQUIRY_RECEIVED_CONSUMER]: EnquiryReceivedConsumerProps;
  [TemplateId.ENQUIRY_STATUS_CHANGED]: EnquiryStatusChangedProps;
  [TemplateId.BUDGET_WARNING_80]: BudgetWarning80Props;
  [TemplateId.BUDGET_EXHAUSTED_ADMIN]: BudgetExhaustedAdminProps;
  [TemplateId.BUDGET_EXHAUSTED_CONSUMER]: BudgetExhaustedConsumerProps;
  [TemplateId.ACCOUNT_SUSPENDED]: AccountSuspendedProps;
  [TemplateId.ACCOUNT_DELETION_CONFIRMED]: AccountDeletionConfirmedProps;
  [TemplateId.RENDER_READY]: RenderReadyProps;
  [TemplateId.SHARE_LINK_COMMENT]: ShareLinkCommentProps;
  [TemplateId.MODERATION_BACKLOG_ALERT]: ModerationBacklogAlertProps;
  [TemplateId.GENERATION_FAILURE_RATE_ALERT]: GenerationFailureRateAlertProps;
  [TemplateId.PURGE_JOB_FAILED]: PurgeJobFailedProps;
}

export type TemplateRegistry = {
  readonly [K in TemplateId]: TemplateDefinition<TemplatePropsMap[K]>;
};

export const TEMPLATE_REGISTRY: TemplateRegistry = {
  [TemplateId.VERIFY_EMAIL]: verifyEmailTemplate,
  [TemplateId.PASSWORD_RESET]: passwordResetTemplate,
  [TemplateId.ADMIN_INVITE]: adminInviteTemplate,
  [TemplateId.OTP_SMS]: otpSmsTemplate,
  [TemplateId.NEW_ENQUIRY_ADMIN]: newEnquiryAdminTemplate,
  [TemplateId.ENQUIRY_RECEIVED_CONSUMER]: enquiryReceivedConsumerTemplate,
  [TemplateId.ENQUIRY_STATUS_CHANGED]: enquiryStatusChangedTemplate,
  [TemplateId.BUDGET_WARNING_80]: budgetWarning80Template,
  [TemplateId.BUDGET_EXHAUSTED_ADMIN]: budgetExhaustedAdminTemplate,
  [TemplateId.BUDGET_EXHAUSTED_CONSUMER]: budgetExhaustedConsumerTemplate,
  [TemplateId.ACCOUNT_SUSPENDED]: accountSuspendedTemplate,
  [TemplateId.ACCOUNT_DELETION_CONFIRMED]: accountDeletionConfirmedTemplate,
  [TemplateId.RENDER_READY]: renderReadyTemplate,
  [TemplateId.SHARE_LINK_COMMENT]: shareLinkCommentTemplate,
  [TemplateId.MODERATION_BACKLOG_ALERT]: moderationBacklogAlertTemplate,
  [TemplateId.GENERATION_FAILURE_RATE_ALERT]: generationFailureRateAlertTemplate,
  [TemplateId.PURGE_JOB_FAILED]: purgeJobFailedTemplate,
};

export const TEMPLATE_IDS: readonly TemplateId[] = Object.values(TemplateId);

/**
 * Narrows a string read out of `notifications_outbox.template`. The outbox processor calls this
 * before rendering, so an unknown row fails loudly instead of silently sending nothing.
 */
export function isTemplateId(value: string): value is TemplateId {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_REGISTRY, value);
}

/** Renders one template. Throws `NotificationTemplateError` when the id is not in the registry. */
export function renderTemplate<K extends TemplateId>(
  templateId: K,
  props: TemplatePropsMap[K],
  context: TemplateContext,
): RenderedTemplate {
  if (!isTemplateId(templateId)) {
    throw new NotificationTemplateError(`Unknown template id: ${String(templateId)}.`);
  }
  return TEMPLATE_REGISTRY[templateId].render(props, context);
}
