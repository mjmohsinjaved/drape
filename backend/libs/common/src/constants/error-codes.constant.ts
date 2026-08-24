import { HttpStatus } from '@nestjs/common';

export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_INVALID = 'SESSION_INVALID',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  ACCOUNT_PENDING_APPROVAL = 'ACCOUNT_PENDING_APPROVAL',
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  PHONE_NOT_VERIFIED = 'PHONE_NOT_VERIFIED',
  TWOFA_REQUIRED = 'TWOFA_REQUIRED',
  TWOFA_INVALID = 'TWOFA_INVALID',
  TWOFA_ALREADY_ENABLED = 'TWOFA_ALREADY_ENABLED',
  PASSWORD_POLICY_VIOLATION = 'PASSWORD_POLICY_VIOLATION',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_ALREADY_USED = 'TOKEN_ALREADY_USED',
  OTP_INVALID = 'OTP_INVALID',
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_MAX_ATTEMPTS = 'OTP_MAX_ATTEMPTS',
  CSRF_TOKEN_MISSING = 'CSRF_TOKEN_MISSING',
  CSRF_TOKEN_INVALID = 'CSRF_TOKEN_INVALID',
  INSUFFICIENT_ROLE = 'INSUFFICIENT_ROLE',
  SELF_ROLE_CHANGE_FORBIDDEN = 'SELF_ROLE_CHANGE_FORBIDDEN',
  LAST_ADMIN_PROTECTED = 'LAST_ADMIN_PROTECTED',
  BOT_CHECK_FAILED = 'BOT_CHECK_FAILED',

  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  PHONE_ALREADY_EXISTS = 'PHONE_ALREADY_EXISTS',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INVITE_NOT_FOUND = 'INVITE_NOT_FOUND',
  INVITE_EXPIRED = 'INVITE_EXPIRED',
  INVITE_ALREADY_CONSUMED = 'INVITE_ALREADY_CONSUMED',
  DELETION_IN_PROGRESS = 'DELETION_IN_PROGRESS',

  CONSENT_REQUIRED = 'CONSENT_REQUIRED',
  CONSENT_STALE = 'CONSENT_STALE',
  QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  BUDGET_EXHAUSTED = 'BUDGET_EXHAUSTED',
  GARMENT_NOT_PUBLISHED = 'GARMENT_NOT_PUBLISHED',
  TEST_RENDER_REQUIRED = 'TEST_RENDER_REQUIRED',
  PHOTO_NOT_OWNED = 'PHOTO_NOT_OWNED',
  IDEMPOTENCY_IN_FLIGHT = 'IDEMPOTENCY_IN_FLIGHT',

  RESULT_NOT_OWNED = 'RESULT_NOT_OWNED',
  JOB_NOT_OWNED = 'JOB_NOT_OWNED',
  ENQUIRY_NOT_OWNED = 'ENQUIRY_NOT_OWNED',
  SHORTLIST_ITEM_NOT_OWNED = 'SHORTLIST_ITEM_NOT_OWNED',
  SHARE_LINK_NOT_OWNED = 'SHARE_LINK_NOT_OWNED',

  UPSTREAM_NO_GARMENT_DETECTED = 'UPSTREAM_NO_GARMENT_DETECTED',
  UPSTREAM_UNSUPPORTED_FORMAT = 'UPSTREAM_UNSUPPORTED_FORMAT',
  MODERATION_REJECTED = 'MODERATION_REJECTED',
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
  UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE',
  UPSTREAM_RATE_LIMITED = 'UPSTREAM_RATE_LIMITED',
  UPSTREAM_INVALID_RESPONSE = 'UPSTREAM_INVALID_RESPONSE',
  TRYON_PROVIDER_MISCONFIGURED = 'TRYON_PROVIDER_MISCONFIGURED',

  CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND',
  CATEGORY_HAS_PUBLISHED_GARMENTS = 'CATEGORY_HAS_PUBLISHED_GARMENTS',
  CATEGORY_DEPTH_EXCEEDED = 'CATEGORY_DEPTH_EXCEEDED',
  CATEGORY_ARCHIVED = 'CATEGORY_ARCHIVED',
  GARMENT_NOT_FOUND = 'GARMENT_NOT_FOUND',
  GARMENT_SKU_EXISTS = 'GARMENT_SKU_EXISTS',
  INVALID_PUBLISH_TRANSITION = 'INVALID_PUBLISH_TRANSITION',
  TRYON_SOURCE_REQUIRED = 'TRYON_SOURCE_REQUIRED',
  TRYON_SOURCE_ALREADY_SET = 'TRYON_SOURCE_ALREADY_SET',
  GARMENT_QUALITY_BELOW_THRESHOLD = 'GARMENT_QUALITY_BELOW_THRESHOLD',
  QUALITY_OVERRIDE_REQUIRED = 'QUALITY_OVERRIDE_REQUIRED',
  IMAGE_TOO_SMALL = 'IMAGE_TOO_SMALL',
  IMAGE_FORMAT_UNSUPPORTED = 'IMAGE_FORMAT_UNSUPPORTED',
  IMAGE_TOO_LARGE = 'IMAGE_TOO_LARGE',
  IMAGE_CORRUPT = 'IMAGE_CORRUPT',
  BULK_OPERATION_PARTIAL_FAILURE = 'BULK_OPERATION_PARTIAL_FAILURE',

  CONSENT_POLICY_NOT_FOUND = 'CONSENT_POLICY_NOT_FOUND',
  PHOTO_LIMIT_REACHED = 'PHOTO_LIMIT_REACHED',
  PHOTO_VALIDATION_FAILED = 'PHOTO_VALIDATION_FAILED',
  PHOTO_BLOCKED_BY_MODERATION = 'PHOTO_BLOCKED_BY_MODERATION',
  PHOTO_NOT_FOUND = 'PHOTO_NOT_FOUND',
  RESULT_NOT_FOUND = 'RESULT_NOT_FOUND',
  JOB_NOT_FOUND = 'JOB_NOT_FOUND',
  SHORTLIST_ITEM_NOT_FOUND = 'SHORTLIST_ITEM_NOT_FOUND',
  SHORTLIST_EMPTY = 'SHORTLIST_EMPTY',
  SHARE_LINK_NOT_FOUND = 'SHARE_LINK_NOT_FOUND',
  SHARE_LINK_REVOKED = 'SHARE_LINK_REVOKED',
  SHARE_LINK_EXPIRED = 'SHARE_LINK_EXPIRED',
  SHARING_DISABLED = 'SHARING_DISABLED',
  VOTE_ALREADY_CAST = 'VOTE_ALREADY_CAST',
  ENQUIRIES_DISABLED = 'ENQUIRIES_DISABLED',
  ENQUIRY_NOT_FOUND = 'ENQUIRY_NOT_FOUND',
  ENQUIRY_ALREADY_OPEN = 'ENQUIRY_ALREADY_OPEN',
  ENQUIRY_LOST_REASON_REQUIRED = 'ENQUIRY_LOST_REASON_REQUIRED',
  INVALID_ENQUIRY_TRANSITION = 'INVALID_ENQUIRY_TRANSITION',

  QUOTA_ADJUSTMENT_INVALID = 'QUOTA_ADJUSTMENT_INVALID',
  MODERATION_ITEM_NOT_FOUND = 'MODERATION_ITEM_NOT_FOUND',
  MODERATION_ALREADY_REVIEWED = 'MODERATION_ALREADY_REVIEWED',
  IP_BLOCKED = 'IP_BLOCKED',
  SETTINGS_KEY_UNKNOWN = 'SETTINGS_KEY_UNKNOWN',
  SETTINGS_VALUE_INVALID = 'SETTINGS_VALUE_INVALID',
  FILE_TOKEN_INVALID = 'FILE_TOKEN_INVALID',
  FILE_TOKEN_EXPIRED = 'FILE_TOKEN_EXPIRED',
  FILE_TOKEN_SUBJECT_MISMATCH = 'FILE_TOKEN_SUBJECT_MISMATCH',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  UPLOAD_TICKET_INVALID = 'UPLOAD_TICKET_INVALID',
  UPLOAD_TICKET_EXPIRED = 'UPLOAD_TICKET_EXPIRED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
  STORAGE_PATH_REJECTED = 'STORAGE_PATH_REJECTED',
  EXPORT_NOT_READY = 'EXPORT_NOT_READY',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

export interface ErrorCodeSpec {
  status: HttpStatus;
  message: string;
  consumerFacing: boolean;
}

const HTTP_MULTI_STATUS = 207 as HttpStatus;
const HTTP_LOCKED = 423 as HttpStatus;

export const ERROR_CODE_SPECS: Readonly<Record<ErrorCode, ErrorCodeSpec>> = {
  [ErrorCode.AUTH_REQUIRED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Sign in to continue.',
    consumerFacing: true,
  },
  [ErrorCode.SESSION_EXPIRED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your session has ended. Sign in again to pick up where you left off.',
    consumerFacing: true,
  },
  [ErrorCode.SESSION_INVALID]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your session has ended. Sign in again to pick up where you left off.',
    consumerFacing: true,
  },
  [ErrorCode.INVALID_CREDENTIALS]: {
    status: HttpStatus.UNAUTHORIZED,
    message: "That email and password don't match an account.",
    consumerFacing: true,
  },
  [ErrorCode.ACCOUNT_LOCKED]: {
    status: HTTP_LOCKED,
    message: 'Too many attempts. Try again in a few minutes.',
    consumerFacing: true,
  },
  [ErrorCode.ACCOUNT_SUSPENDED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Your account is not active. Please contact our support team.',
    consumerFacing: true,
  },
  [ErrorCode.ACCOUNT_DEACTIVATED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'This account is closed. Please contact our support team.',
    consumerFacing: true,
  },
  [ErrorCode.ACCOUNT_PENDING_APPROVAL]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Your account is not active yet. It is waiting to be approved.',
    consumerFacing: true,
  },
  [ErrorCode.EMAIL_NOT_VERIFIED]: {
    status: HttpStatus.FORBIDDEN,
    message: "Confirm your email to start trying pieces on. We've sent you a link.",
    consumerFacing: true,
  },
  [ErrorCode.PHONE_NOT_VERIFIED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Confirm your phone number to send this enquiry.',
    consumerFacing: true,
  },
  [ErrorCode.TWOFA_REQUIRED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Enter the code from your authenticator app.',
    consumerFacing: true,
  },
  [ErrorCode.TWOFA_INVALID]: {
    status: HttpStatus.UNAUTHORIZED,
    message: "That code didn't work. Try the next one.",
    consumerFacing: true,
  },
  [ErrorCode.TWOFA_ALREADY_ENABLED]: {
    status: HttpStatus.CONFLICT,
    message: 'Two-factor authentication is already on for this account.',
    consumerFacing: true,
  },
  [ErrorCode.PASSWORD_POLICY_VIOLATION]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Choose a password with at least 10 characters, including a number and a symbol.',
    consumerFacing: true,
  },
  [ErrorCode.TOKEN_INVALID]: {
    status: HttpStatus.BAD_REQUEST,
    message: "That link isn't valid. Request a new one.",
    consumerFacing: true,
  },
  [ErrorCode.TOKEN_EXPIRED]: {
    status: HttpStatus.GONE,
    message: 'That link has expired. Request a new one.',
    consumerFacing: true,
  },
  [ErrorCode.TOKEN_ALREADY_USED]: {
    status: HttpStatus.CONFLICT,
    message: 'That link has already been used. Request a new one.',
    consumerFacing: true,
  },
  [ErrorCode.OTP_INVALID]: {
    status: HttpStatus.BAD_REQUEST,
    message: "That code didn't match. Check it and try again.",
    consumerFacing: true,
  },
  [ErrorCode.OTP_EXPIRED]: {
    status: HttpStatus.GONE,
    message: 'That code has expired. Send a new one.',
    consumerFacing: true,
  },
  [ErrorCode.OTP_MAX_ATTEMPTS]: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many tries. Send a new code in a few minutes.',
    consumerFacing: true,
  },
  [ErrorCode.CSRF_TOKEN_MISSING]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Refresh the page and try again.',
    consumerFacing: true,
  },
  [ErrorCode.CSRF_TOKEN_INVALID]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Refresh the page and try again.',
    consumerFacing: true,
  },
  [ErrorCode.INSUFFICIENT_ROLE]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: true,
  },
  [ErrorCode.SELF_ROLE_CHANGE_FORBIDDEN]: {
    status: HttpStatus.FORBIDDEN,
    message: "You can't change your own role.",
    consumerFacing: false,
  },
  [ErrorCode.LAST_ADMIN_PROTECTED]: {
    status: HttpStatus.CONFLICT,
    message: 'At least one admin must stay active.',
    consumerFacing: false,
  },
  [ErrorCode.BOT_CHECK_FAILED]: {
    status: HttpStatus.FORBIDDEN,
    message: "We couldn't verify that request. Try again.",
    consumerFacing: true,
  },

  [ErrorCode.EMAIL_ALREADY_EXISTS]: {
    status: HttpStatus.CONFLICT,
    message: 'An account with this email already exists.',
    consumerFacing: true,
  },
  [ErrorCode.PHONE_ALREADY_EXISTS]: {
    status: HttpStatus.CONFLICT,
    message: 'An account with this phone number already exists.',
    consumerFacing: true,
  },
  [ErrorCode.USER_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that account.",
    consumerFacing: false,
  },
  [ErrorCode.INVITE_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "That invitation isn't valid. Ask an admin to send a new one.",
    consumerFacing: false,
  },
  [ErrorCode.INVITE_EXPIRED]: {
    status: HttpStatus.GONE,
    message: 'That invitation has expired. Ask an admin to send a new one.',
    consumerFacing: false,
  },
  [ErrorCode.INVITE_ALREADY_CONSUMED]: {
    status: HttpStatus.CONFLICT,
    message: 'That invitation has already been used.',
    consumerFacing: false,
  },
  [ErrorCode.DELETION_IN_PROGRESS]: {
    status: HttpStatus.CONFLICT,
    message: 'This account is being deleted. Nothing more can be changed.',
    consumerFacing: true,
  },

  [ErrorCode.CONSENT_REQUIRED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Before your first try-on we need your go-ahead on how your photo is used.',
    consumerFacing: true,
  },
  [ErrorCode.CONSENT_STALE]: {
    status: HttpStatus.FORBIDDEN,
    message: "We've updated how we handle your photo. Have a read and confirm to carry on.",
    consumerFacing: true,
  },
  [ErrorCode.QUOTA_EXHAUSTED]: {
    status: HttpStatus.FORBIDDEN,
    message:
      "You've used your try-ons this month — your shortlist is saved, and you can send an enquiry any time.",
    consumerFacing: true,
  },
  [ErrorCode.RATE_LIMIT_EXCEEDED]: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: "You're going a bit fast. Give it a minute and try again.",
    consumerFacing: true,
  },
  [ErrorCode.BUDGET_EXHAUSTED]: {
    status: HttpStatus.FORBIDDEN,
    message: "Our fitting room is at capacity today — we'll email you when it's back.",
    consumerFacing: true,
  },
  [ErrorCode.GARMENT_NOT_PUBLISHED]: {
    status: HttpStatus.NOT_FOUND,
    message: "This piece isn't available right now. Browse the rest of the collection.",
    consumerFacing: true,
  },
  [ErrorCode.TEST_RENDER_REQUIRED]: {
    status: HttpStatus.CONFLICT,
    message: "This piece isn't ready for try-on yet.",
    consumerFacing: true,
  },
  [ErrorCode.PHOTO_NOT_OWNED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: false,
  },
  [ErrorCode.IDEMPOTENCY_IN_FLIGHT]: {
    status: HttpStatus.CONFLICT,
    message: 'That try-on is already running. Hang tight.',
    consumerFacing: true,
  },

  [ErrorCode.RESULT_NOT_OWNED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: false,
  },
  [ErrorCode.JOB_NOT_OWNED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: false,
  },
  [ErrorCode.ENQUIRY_NOT_OWNED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: false,
  },
  [ErrorCode.SHORTLIST_ITEM_NOT_OWNED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: false,
  },
  [ErrorCode.SHARE_LINK_NOT_OWNED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have access to this.",
    consumerFacing: false,
  },

  [ErrorCode.UPSTREAM_NO_GARMENT_DETECTED]: {
    status: HttpStatus.BAD_GATEWAY,
    message: "We're having trouble with this piece — we've been notified. Try another for now.",
    consumerFacing: true,
  },
  [ErrorCode.UPSTREAM_UNSUPPORTED_FORMAT]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "That photo didn't upload properly. Mind trying again?",
    consumerFacing: true,
  },
  [ErrorCode.MODERATION_REJECTED]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "Let's try a different photo — choose another and we'll carry on from here.",
    consumerFacing: true,
  },
  [ErrorCode.UPSTREAM_TIMEOUT]: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: 'Taking longer than usual — hang tight.',
    consumerFacing: true,
  },
  [ErrorCode.UPSTREAM_UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Taking longer than usual — hang tight.',
    consumerFacing: true,
  },
  [ErrorCode.UPSTREAM_RATE_LIMITED]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Taking longer than usual — hang tight.',
    consumerFacing: false,
  },
  [ErrorCode.UPSTREAM_INVALID_RESPONSE]: {
    status: HttpStatus.BAD_GATEWAY,
    message: "We're having trouble with this piece — we've been notified. Try another for now.",
    consumerFacing: true,
  },
  [ErrorCode.TRYON_PROVIDER_MISCONFIGURED]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The fitting room is briefly unavailable. Try again shortly.',
    consumerFacing: true,
  },

  [ErrorCode.CATEGORY_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that category.",
    consumerFacing: false,
  },
  [ErrorCode.CATEGORY_HAS_PUBLISHED_GARMENTS]: {
    status: HttpStatus.CONFLICT,
    message: 'This category still holds published pieces. Archive it instead, or move them first.',
    consumerFacing: false,
  },
  [ErrorCode.CATEGORY_DEPTH_EXCEEDED]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Sub-categories can only go one level deep.',
    consumerFacing: false,
  },
  [ErrorCode.CATEGORY_ARCHIVED]: {
    status: HttpStatus.CONFLICT,
    message: 'This category is archived. Restore it before adding pieces.',
    consumerFacing: false,
  },
  [ErrorCode.GARMENT_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that piece.",
    consumerFacing: true,
  },
  [ErrorCode.GARMENT_SKU_EXISTS]: {
    status: HttpStatus.CONFLICT,
    message: 'Another piece already uses this SKU.',
    consumerFacing: false,
  },
  [ErrorCode.INVALID_PUBLISH_TRANSITION]: {
    status: HttpStatus.CONFLICT,
    message: "A piece can't move from {from} to {to}.",
    consumerFacing: false,
  },
  [ErrorCode.TRYON_SOURCE_REQUIRED]: {
    status: HttpStatus.CONFLICT,
    message: 'Choose a try-on source image before publishing.',
    consumerFacing: false,
  },
  [ErrorCode.TRYON_SOURCE_ALREADY_SET]: {
    status: HttpStatus.CONFLICT,
    message: 'Only one image can be the try-on source.',
    consumerFacing: false,
  },
  [ErrorCode.GARMENT_QUALITY_BELOW_THRESHOLD]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This photo needs work before it can go live.',
    consumerFacing: false,
  },
  [ErrorCode.QUALITY_OVERRIDE_REQUIRED]: {
    status: HttpStatus.CONFLICT,
    message: 'This piece is marked "Needs a better photo". Override to publish anyway.',
    consumerFacing: false,
  },
  [ErrorCode.IMAGE_TOO_SMALL]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This image is {actual}px on the long edge. It needs at least 2000px.',
    consumerFacing: true,
  },
  [ErrorCode.IMAGE_FORMAT_UNSUPPORTED]: {
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    message: 'We accept HEIC, WebP, PNG and JPEG.',
    consumerFacing: true,
  },
  [ErrorCode.IMAGE_TOO_LARGE]: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'That file is over {maxMb}MB. Try a smaller one.',
    consumerFacing: true,
  },
  [ErrorCode.IMAGE_CORRUPT]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "We couldn't read that file. Try exporting it again.",
    consumerFacing: true,
  },
  [ErrorCode.BULK_OPERATION_PARTIAL_FAILURE]: {
    status: HTTP_MULTI_STATUS,
    message: "Some items didn't go through.",
    consumerFacing: false,
  },

  [ErrorCode.CONSENT_POLICY_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't load the current policy. Try again shortly.",
    consumerFacing: true,
  },
  [ErrorCode.PHOTO_LIMIT_REACHED]: {
    status: HttpStatus.CONFLICT,
    message: 'You can keep up to {max} photos. Remove one to add another.',
    consumerFacing: true,
  },
  [ErrorCode.PHOTO_VALIDATION_FAILED]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "This photo won't work for a try-on.",
    consumerFacing: true,
  },
  [ErrorCode.PHOTO_BLOCKED_BY_MODERATION]: {
    status: HttpStatus.FORBIDDEN,
    message: "Let's try a different photo — choose another and we'll carry on from here.",
    consumerFacing: true,
  },
  [ErrorCode.PHOTO_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that photo. Pick another or upload a new one.",
    consumerFacing: true,
  },
  [ErrorCode.RESULT_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that result.",
    consumerFacing: true,
  },
  [ErrorCode.JOB_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that try-on.",
    consumerFacing: true,
  },
  [ErrorCode.SHORTLIST_ITEM_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "That piece isn't on your shortlist.",
    consumerFacing: true,
  },
  [ErrorCode.SHORTLIST_EMPTY]: {
    status: HttpStatus.CONFLICT,
    message: 'Add a piece to your shortlist first.',
    consumerFacing: true,
  },
  [ErrorCode.SHARE_LINK_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "This link isn't available.",
    consumerFacing: true,
  },
  [ErrorCode.SHARE_LINK_REVOKED]: {
    status: HttpStatus.GONE,
    message: 'This link has been turned off by its owner.',
    consumerFacing: true,
  },
  [ErrorCode.SHARE_LINK_EXPIRED]: {
    status: HttpStatus.GONE,
    message: 'This link has expired.',
    consumerFacing: true,
  },
  [ErrorCode.SHARING_DISABLED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Sharing is turned off right now.',
    consumerFacing: true,
  },
  [ErrorCode.VOTE_ALREADY_CAST]: {
    status: HttpStatus.CONFLICT,
    message: "You've already left a note on this piece.",
    consumerFacing: true,
  },
  [ErrorCode.ENQUIRIES_DISABLED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Enquiries are closed right now.',
    consumerFacing: true,
  },
  [ErrorCode.ENQUIRY_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that enquiry.",
    consumerFacing: true,
  },
  [ErrorCode.ENQUIRY_ALREADY_OPEN]: {
    status: HttpStatus.CONFLICT,
    message: "You already have an open enquiry. We'll be in touch.",
    consumerFacing: true,
  },
  [ErrorCode.ENQUIRY_LOST_REASON_REQUIRED]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Add a reason before closing this as lost.',
    consumerFacing: false,
  },
  [ErrorCode.INVALID_ENQUIRY_TRANSITION]: {
    status: HttpStatus.CONFLICT,
    message: "An enquiry can't move from {from} to {to}.",
    consumerFacing: false,
  },

  [ErrorCode.QUOTA_ADJUSTMENT_INVALID]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Enter a whole number between {min} and {max}.',
    consumerFacing: false,
  },
  [ErrorCode.MODERATION_ITEM_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that item.",
    consumerFacing: false,
  },
  [ErrorCode.MODERATION_ALREADY_REVIEWED]: {
    status: HttpStatus.CONFLICT,
    message: 'Someone has already reviewed this item.',
    consumerFacing: false,
  },
  [ErrorCode.IP_BLOCKED]: {
    status: HttpStatus.FORBIDDEN,
    message: "We can't complete that request.",
    consumerFacing: true,
  },
  [ErrorCode.SETTINGS_KEY_UNKNOWN]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Unknown setting.',
    consumerFacing: false,
  },
  [ErrorCode.SETTINGS_VALUE_INVALID]: {
    status: HttpStatus.BAD_REQUEST,
    message: "That value isn't allowed for this setting.",
    consumerFacing: false,
  },
  [ErrorCode.FILE_TOKEN_INVALID]: {
    status: HttpStatus.FORBIDDEN,
    message: "This link isn't valid.",
    consumerFacing: true,
  },
  [ErrorCode.FILE_TOKEN_EXPIRED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'This link has expired. Refresh the page.',
    consumerFacing: true,
  },
  [ErrorCode.FILE_TOKEN_SUBJECT_MISMATCH]: {
    status: HttpStatus.FORBIDDEN,
    message: "This link isn't valid.",
    consumerFacing: true,
  },
  [ErrorCode.FILE_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that file.",
    consumerFacing: true,
  },
  [ErrorCode.UPLOAD_TICKET_INVALID]: {
    status: HttpStatus.FORBIDDEN,
    message: "That upload link isn't valid. Start the upload again.",
    consumerFacing: true,
  },
  [ErrorCode.UPLOAD_TICKET_EXPIRED]: {
    status: HttpStatus.GONE,
    message: 'That upload link expired. Start the upload again.',
    consumerFacing: true,
  },
  [ErrorCode.STORAGE_WRITE_FAILED]: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "We couldn't save that. Try again.",
    consumerFacing: true,
  },
  [ErrorCode.STORAGE_PATH_REJECTED]: {
    status: HttpStatus.BAD_REQUEST,
    message: "We couldn't save that.",
    consumerFacing: true,
  },
  [ErrorCode.EXPORT_NOT_READY]: {
    status: HttpStatus.CONFLICT,
    message: "Your export is still being prepared. We'll email you when it's ready.",
    consumerFacing: true,
  },
  [ErrorCode.VALIDATION_ERROR]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Check the highlighted fields.',
    consumerFacing: true,
  },
  [ErrorCode.RESOURCE_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that.",
    consumerFacing: true,
  },
  [ErrorCode.RESOURCE_CONFLICT]: {
    status: HttpStatus.CONFLICT,
    message: 'Something changed while you were working. Reload and try again.',
    consumerFacing: true,
  },
  [ErrorCode.INTERNAL_ERROR]: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: "Something went wrong on our side. We've been notified.",
    consumerFacing: true,
  },
  [ErrorCode.SERVICE_UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: "We're briefly unavailable. Try again shortly.",
    consumerFacing: true,
  },
};

export const MASKED_ERROR_CODES: Readonly<Partial<Record<ErrorCode, ErrorCode>>> = {
  [ErrorCode.PHOTO_NOT_OWNED]: ErrorCode.PHOTO_NOT_FOUND,
  [ErrorCode.RESULT_NOT_OWNED]: ErrorCode.RESULT_NOT_FOUND,
  [ErrorCode.JOB_NOT_OWNED]: ErrorCode.JOB_NOT_FOUND,
  [ErrorCode.ENQUIRY_NOT_OWNED]: ErrorCode.ENQUIRY_NOT_FOUND,
  [ErrorCode.SHORTLIST_ITEM_NOT_OWNED]: ErrorCode.SHORTLIST_ITEM_NOT_FOUND,
  [ErrorCode.SHARE_LINK_NOT_OWNED]: ErrorCode.SHARE_LINK_NOT_FOUND,
};

export const MASK_TARGET_ERROR_CODES: ReadonlySet<ErrorCode> = new Set(
  Object.values(MASKED_ERROR_CODES).filter((code): code is ErrorCode => code !== undefined),
);

export function isMaskTargetErrorCode(code: ErrorCode): boolean {
  return MASK_TARGET_ERROR_CODES.has(code);
}

export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode);

export function getErrorCodeSpec(code: ErrorCode): ErrorCodeSpec {
  return ERROR_CODE_SPECS[code];
}

export function maskErrorCode(code: ErrorCode): ErrorCode {
  return MASKED_ERROR_CODES[code] ?? code;
}

export function isMaskedErrorCode(code: ErrorCode): boolean {
  return MASKED_ERROR_CODES[code] !== undefined;
}

export function httpStatusForErrorCode(code: ErrorCode): HttpStatus {
  return ERROR_CODE_SPECS[maskErrorCode(code)].status;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODE_SPECS, value);
}
