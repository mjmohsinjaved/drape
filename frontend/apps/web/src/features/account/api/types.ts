import type { BudgetBand, EventType, Locale, Role, UserStatus } from '@repo/api-client';

/**
 * The `/me` wire shapes of §5.2, as the API serialises them today.
 *
 * As with `features/auth/api/types.ts`, these are written against the NestJS DTOs rather than
 * `@repo/api-client`'s `types/users.ts`, and the divergences are marked `CONTRACT`.
 */

/**
 * `MeResponseDto` — `GET /me`, `PATCH /me`.
 *
 * CONTRACT: the package's `MyAccount` declares `emailVerifiedAt`, `phoneVerifiedAt` and
 * `twofaEnabledAt` as nullable timestamps. The DTO sends three booleans — `emailVerified`,
 * `phoneVerified`, `twofaEnabled` — and adds `lastLoginAt`.
 */
export interface MyAccount {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  locale: Locale;
  emailVerified: boolean;
  phoneVerified: boolean;
  twofaEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Set once she has asked for deletion; the purge completes within the SLA (C-38). */
  deletionRequestedAt: string | null;
}

/**
 * `PATCH /me`. Email, role and status are not writable here.
 *
 * Changing the phone clears its verification server-side, so C-3 asks for it again before the
 * next enquiry. The form says so before the change is saved.
 */
export interface UpdateMyAccountBody {
  name?: string;
  phone?: string;
  locale?: Locale;
}

/**
 * `ConsumerProfileResponseDto` — `GET /me/profile` (C-2).
 *
 * CONTRACT: the package's `ConsumerProfile` carries `userId`; the DTO does not, and it adds a
 * read-only `monthlyQuotaOverride` (an admin control, A-18).
 */
export interface ConsumerProfile {
  eventDate: string | null;
  eventType: EventType | null;
  budgetBand: BudgetBand | null;
  preferredCategories: string[];
  monthlyQuotaOverride: number | null;
  onboardingCompletedAt: string | null;
}

/** `PATCH /me/profile`. Every field is optional; `null` clears one she would rather not share. */
export interface UpdateConsumerProfileBody {
  eventDate?: string | null;
  eventType?: EventType | null;
  budgetBand?: BudgetBand | null;
  preferredCategories?: string[];
}

/** `GET` / `PATCH /me/notification-preferences` (C-7). The PATCH body is a partial. */
export interface NotificationPreferences {
  emailOnResultReady: boolean;
  emailOnEnquiryUpdate: boolean;
  emailOnNewArrivals: boolean;
  smsOnEnquiryUpdate: boolean;
}

export type UpdateNotificationPreferencesBody = Partial<NotificationPreferences>;
