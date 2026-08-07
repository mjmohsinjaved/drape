import { AdminUserResponseDto } from '../dto/admin-user-response.dto';
import { MeResponseDto } from '../dto/me-response.dto';

import type { User } from '../entities/user.entity';

/**
 * `users` entity → response DTO. **The only place that shape is decided** (§2.9).
 *
 * Both mappers below build a fresh DTO field by field rather than spreading the
 * entity. That is the point: a spread would carry `passwordHash` onto the wire the
 * moment somebody adds a column, and a
 * deny-list would have to be updated to stop it. An allow-list fails safe — a new
 * column is invisible until someone deliberately adds it here.
 */

/** `GET /admin/users`, `GET /admin/users/:userId` (A-2). */
export function toAdminUserResponse(user: User): AdminUserResponseDto {
  const dto = new AdminUserResponseDto();
  dto.id = user.id;
  dto.name = user.name;
  dto.email = user.email;
  dto.role = user.role;
  dto.status = user.status;
  dto.locale = user.locale;
  dto.emailVerified = user.emailVerifiedAt !== null;
  dto.lastLoginAt = user.lastLoginAt;
  dto.lastActiveAt = user.lastActiveAt;
  dto.suspendedAt = user.suspendedAt;
  dto.invitedBy = user.invitedBy;
  dto.createdAt = user.createdAt;
  return dto;
}

/** `GET /me`, `PATCH /me` (§5.2). */
export function toMeResponse(user: User): MeResponseDto {
  const dto = new MeResponseDto();
  dto.id = user.id;
  dto.name = user.name;
  dto.email = user.email;
  dto.phone = user.phone;
  dto.role = user.role;
  dto.status = user.status;
  dto.locale = user.locale;
  dto.emailVerified = user.emailVerifiedAt !== null;
  dto.phoneVerified = user.phoneVerifiedAt !== null;
  dto.createdAt = user.createdAt;
  dto.lastLoginAt = user.lastLoginAt;
  dto.deletionRequestedAt = user.deletionRequestedAt;
  return dto;
}
