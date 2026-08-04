/**
 * `role_enum` (ARCHITECTURE §4.1).
 *
 * The canonical TypeScript declaration lives in `@library/common`
 * (`constants/roles.constant.ts`) because `@Roles()` needs the TS-only
 * `Role.PUBLIC` member and `libs/*` may never import from `@api/*` (§1.1).
 * It is re-exported here so every entity resolves its enums from the owning
 * module's `enums/` folder (§4.33).
 */
import { Role, USER_ROLES } from '@library/common';

export { Role };

/**
 * The subset of `Role` persisted in the PostgreSQL `role_enum` type, as a mutable
 * array because that is what TypeORM's `@Column({ enum })` option accepts.
 * `Role.PUBLIC` is never stored (§4.1).
 */
export const ROLE_ENUM_VALUES: Role[] = [...USER_ROLES];
