import { InviteResponseDto, InviteTokenPreviewResponseDto } from '../dto/invite-response.dto';
import { deriveInviteStatus } from '../enums/invite-status.enum';

import type { Invite } from '../entities/invite.entity';

/**
 * `invites` entity → response DTO. The only place that shape is decided (§2.9).
 *
 * Built field by field rather than spread, and the field that matters most is the
 * one that is missing: `tokenHash`. A spread would put it on the wire the moment
 * somebody forgot a deny-list entry, and a hash is enough to identify an invite in
 * any log it later appears in.
 */
export function toInviteResponse(invite: Invite, now: Date = new Date()): InviteResponseDto {
  const dto = new InviteResponseDto();
  dto.id = invite.id;
  dto.email = invite.email;
  dto.role = invite.role;
  dto.status = deriveInviteStatus(invite, now);
  dto.expiresAt = invite.expiresAt;
  dto.consumedAt = invite.consumedAt;
  dto.invitedBy = invite.invitedBy;
  dto.consumedByUserId = invite.consumedByUserId;
  dto.createdAt = invite.createdAt;
  return dto;
}

/**
 * The public acceptance-form preview.
 *
 * Three fields, chosen for what they leave out: no inviter, no invite id, no
 * timestamps beyond the expiry. An unauthenticated caller learns only what they
 * need in order to set a password on an address they were already emailed at.
 */
export function toInviteTokenPreview(invite: Invite): InviteTokenPreviewResponseDto {
  const dto = new InviteTokenPreviewResponseDto();
  dto.email = invite.email;
  dto.role = invite.role;
  dto.expiresAt = invite.expiresAt;
  return dto;
}
