/**
 * `locale_enum` (ARCHITECTURE §4.1).
 *
 * The canonical declaration lives in `@library/common` (`constants/roles.constant.ts`)
 * because `ICurrentUser` (§2.6) is declared in that library and `libs/*` may never
 * import from `@api/*` (§1.1). Re-exported here so every entity resolves its enums
 * from the owning module's `enums/` folder (§4.33), and so there is exactly one
 * `Locale` type in the codebase.
 */
export { Locale } from '@library/common';
