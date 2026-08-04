import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

/**
 * ARCHITECTURE.md §2.2 — entity **columns** are camelCase and are never overridden with
 * `{ name: 'snake_case' }`. Table names are snake_case and are declared in the `@Entity()`
 * decorator only.
 *
 * TypeORM's default strategy already preserves property names, but "already does the right
 * thing by default" is not a guarantee — installing a snake-case strategy is a one-line change
 * that would silently rename every column in the schema and break every hand-written migration
 * and every `where: '"deletedAt" IS NULL'` predicate. Pinning this strategy on the DataSource
 * makes the choice explicit and reviewable.
 *
 * Consequence: every migration and every raw query quotes identifiers — `"deletedAt"`, not
 * `deletedAt`, because unquoted identifiers fold to lower case in PostgreSQL.
 */
export class CamelCaseNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  /**
   * Column name = the property name, verbatim. Embedded columns keep camelCase joins
   * (`address` + `line1` -> `addressLine1`) rather than the default underscore join.
   */
  columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const name = customName ?? propertyName;
    if (embeddedPrefixes.length === 0) {
      return name;
    }
    return [...embeddedPrefixes, name]
      .map((segment, index) => (index === 0 ? segment : capitalise(segment)))
      .join('');
  }

  /**
   * Table name = exactly what `@Entity('snake_case_plural')` declared. Falls back to the
   * default derivation only for TypeORM-internal targets that carry no explicit name.
   */
  tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ?? super.tableName(targetName, userSpecifiedName);
  }
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
