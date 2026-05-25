/**
 * Tree of PostgreSQL objects surfaced to the renderer.
 *
 * Each schema (the PG namespace concept — `public`, `analytics`, etc.) groups
 * its tables and views separately so the sidebar can render distinct icons
 * without re-deriving the kind per row. System schemas (`pg_catalog`,
 * `information_schema`) are filtered out in the service; everything that
 * reaches the renderer is user-relevant.
 */
export interface PostgresSchemaNode {
  name: string;
  tables: PostgresTableNode[];
  views: PostgresViewNode[];
}

export interface PostgresTableNode {
  name: string;
}

export interface PostgresViewNode {
  name: string;
  /** True for `MATERIALIZED VIEW`, false for regular `VIEW`. */
  materialized: boolean;
}
