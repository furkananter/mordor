/**
 * Shared types for the database export pipeline. Lives at `src/core/export/`
 * so all three engine packages (`cassandra`, `postgres`, `redis`) can import
 * the same primitives without forming a cycle through each other.
 *
 * Vocabulary:
 *   - SCOPE     — what subset to export. Table = one table, Scope = one
 *                 keyspace/schema/db, Full = everything reachable from the
 *                 connection.
 *   - ARTIFACT  — a single file in the output folder (schema script, data
 *                 script, per-table CSV, manifest, README).
 *   - REQUEST   — fully-resolved export plan; produced in the renderer and
 *                 handed to the main process IPC.
 *   - RESULT    — what the main process returns once writing finishes.
 *
 * Redis has no schema, so its requests carry a `redisDb` instead of a
 * keyspace/schema name — the dispatcher branches on `profile.type`.
 */

export type ExportScope = "table" | "schema" | "full";

export interface ExportTableTarget {
  /** Cassandra keyspace / Postgres schema. Required for non-redis engines. */
  keyspace: string;
  /** Table name. */
  table: string;
}

export interface ExportScopeTarget {
  /** Cassandra keyspace / Postgres schema. */
  keyspace: string;
}

/**
 * Engine-agnostic request the renderer sends. The main process picks the right
 * adapter based on `profileId` (looked up via the profile store).
 */
export interface ExportRequest {
  profileId: string;
  scope: ExportScope;
  /** Output folder picked by the user (absolute path). */
  outputDir: string;
  /** Required when scope = "table". */
  table?: ExportTableTarget;
  /** Required when scope = "schema" (ignored for Redis — no schema concept). */
  schema?: ExportScopeTarget;
  /**
   * Redis-only: which logical DB index to export (0-15). Defaults to the
   * profile's current db when omitted. Ignored for Cassandra/Postgres.
   */
  redisDb?: number;
}

export interface ExportArtifact {
  /** Relative path under the export folder (e.g. "schema.sql", "data/orders.csv"). */
  relativePath: string;
  /** Bytes written (post-encoding). */
  byteCount: number;
}

export interface ExportTableSummary {
  keyspace: string;
  table: string;
  rowsExported: number;
  /** Truncated because the row cap was hit; the dump is incomplete for this table. */
  truncated: boolean;
}

export interface ExportResult {
  /** Absolute path to the folder we wrote into. */
  folderPath: string;
  /** Wall-clock duration of the entire export. */
  durationMs: number;
  /** Engine that produced this dump — useful for the UI's success label. */
  engine: "cassandra" | "postgres" | "redis";
  artifacts: ExportArtifact[];
  tables: ExportTableSummary[];
  /** Redis only: total keys exported (Cassandra/Postgres uses `tables` instead). */
  keysExported?: number;
  /** Non-fatal issues — skipped objects, type approximations, truncation. */
  warnings: string[];
}

/**
 * Per-engine cap on how many rows we serialize for a single table. The cap
 * exists to keep "export entire database" from hanging the UI on a multi-
 * billion-row prod cluster — comprehensive export ≠ infinite. When a table is
 * truncated the `truncated` flag is set so the manifest + UI can mention it.
 *
 * 1 million was picked as the smallest cap that comfortably covers every
 * dev/staging DB we've seen in the wild while still bounding worst-case memory
 * (the CSV/SQL writers stream chunk-by-chunk, but pagination state in the
 * driver still grows with row count).
 */
export const EXPORT_ROW_CAP = 1_000_000;

/**
 * Chunk size for cursor / paging-state batches. Tuned so the per-batch round
 * trip stays under ~500 ms on a typical local cluster while keeping memory
 * pressure inside a single Node process bounded.
 */
export const EXPORT_BATCH_SIZE = 1_000;
