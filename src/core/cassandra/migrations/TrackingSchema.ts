import {
  AppliedRow,
  ApplyOutcome,
  MigrationEntry,
  REQUIRED_TRACKING_COLUMNS,
  TRACKING_TABLE,
  quoteIdent
} from "./types";

/** One column of a `schema_migrations` table, as reported by system_schema. */
export interface TrackingColumn {
  name: string;
  type: string;
  /** partition_key | clustering | regular | static */
  kind: string;
}

/**
 * Maps Mordor's logical migration fields onto the *actual* column names found in
 * a `schema_migrations` table, so we can read from / write to a table that some
 * other migration tool created. Only `version` is required; the rest are filled
 * in when a matching column exists.
 */
export interface TrackingColumnMap {
  version: string;
  versionType: string;
  filename?: string;
  checksum?: string;
  appliedAt?: string;
  success?: string;
  /** true when `success` is mapped onto an inverted flag like golang-migrate's `dirty`. */
  successInverted?: boolean;
  errorMessage?: string;
}

export type TrackingMode = "native" | "adopted" | "adopted-readonly";

export type TrackingAdapter =
  | { kind: "absent" }
  | { kind: "ready"; mode: TrackingMode; map: TrackingColumnMap; columns: string[]; tool?: string }
  | { kind: "unusable"; columns: string[] };

// Column-name aliases, lowercased, in priority order.
// A column literally named `version` is almost always the migration identifier
// users care about (Flyway/Rails/golang-migrate all use it), so it wins over a
// sequential apply-order key like Flyway's `installed_rank`.
const PRIMARY_VERSION = ["version", "version_number", "migration_version"];
const KEY_VERSION = ["installed_rank", "migration_id", "id"];
const VERSION_ALIASES = [...PRIMARY_VERSION, ...KEY_VERSION, "migration", "name", "script", "script_name", "filename"];
const FILENAME_ALIASES = ["filename", "file_name", "file", "script", "script_name", "name", "description", "migration_name"];
const CHECKSUM_ALIASES = ["checksum", "md5sum", "md5", "hash", "digest", "sha256", "sha"];
const APPLIED_AT_ALIASES = [
  "applied_at", "installed_on", "executed_at", "dateexecuted", "date_executed",
  "created_at", "applied_on", "applied", "run_on", "timestamp", "ts"
];
const SUCCESS_ALIASES = ["success", "succeeded", "applied_successful", "is_success"];
const FAILURE_ALIASES = ["dirty", "failed", "is_dirty", "has_error", "errored"];
const ERROR_ALIASES = ["error_message", "error", "errormsg", "message", "failure_reason", "reason", "last_error"];

const NUMERIC_CQL_TYPES = new Set(["int", "bigint", "smallint", "tinyint", "varint", "counter"]);

export function isWritable(mode: TrackingMode): boolean {
  return mode !== "adopted-readonly";
}

/** The canonical mapping for Mordor's own `schema_migrations` layout. */
export function nativeMap(versionType = "text"): TrackingColumnMap {
  return {
    version: "version",
    versionType,
    filename: "filename",
    checksum: "checksum",
    appliedAt: "applied_at",
    success: "success",
    successInverted: false,
    errorMessage: "error_message"
  };
}

/**
 * Resolve a column map for a foreign table by matching its columns against the
 * alias lists. Returns null when no version/identifier column can be found, in
 * which case the table is unusable for tracking.
 */
export function resolveColumnMap(columns: TrackingColumn[]): TrackingColumnMap | null {
  const byLower = new Map<string, TrackingColumn>();
  for (const col of columns) byLower.set(col.name.toLowerCase(), col);
  const keyColumns = new Set(
    columns.filter((c) => c.kind === "partition_key" || c.kind === "clustering").map((c) => c.name.toLowerCase())
  );

  const pick = (aliases: string[], used: Set<string>): string | undefined => {
    for (const alias of aliases) {
      const col = byLower.get(alias);
      if (col && !used.has(alias)) return col.name;
    }
    return undefined;
  };

  // Version: prefer a column literally named `version` (the migration identifier),
  // then a primary-key apply-order column (Flyway's `installed_rank`), then weaker
  // aliases — so a `filename`/`name` column isn't mistaken for the version.
  let versionName: string | undefined;
  for (const alias of PRIMARY_VERSION) {
    const col = byLower.get(alias);
    if (col) {
      versionName = col.name;
      break;
    }
  }
  if (!versionName) {
    for (const alias of KEY_VERSION) {
      if (keyColumns.has(alias)) {
        versionName = byLower.get(alias)!.name;
        break;
      }
    }
  }
  if (!versionName) versionName = pick(VERSION_ALIASES, new Set());
  if (!versionName) return null;

  const used = new Set<string>([versionName.toLowerCase()]);
  const take = (aliases: string[]): string | undefined => {
    const found = pick(aliases, used);
    if (found) used.add(found.toLowerCase());
    return found;
  };

  const filename = take(FILENAME_ALIASES);
  const checksum = take(CHECKSUM_ALIASES);
  const appliedAt = take(APPLIED_AT_ALIASES);

  let success = take(SUCCESS_ALIASES);
  let successInverted = false;
  if (!success) {
    const failure = take(FAILURE_ALIASES);
    if (failure) {
      success = failure;
      successInverted = true;
    }
  }

  const errorMessage = take(ERROR_ALIASES);

  const map: TrackingColumnMap = {
    version: versionName,
    versionType: byLower.get(versionName.toLowerCase())!.type
  };
  if (filename) map.filename = filename;
  if (checksum) map.checksum = checksum;
  if (appliedAt) map.appliedAt = appliedAt;
  if (success) {
    map.success = success;
    map.successInverted = successInverted;
  }
  if (errorMessage) map.errorMessage = errorMessage;
  return map;
}

/** Best-effort label for the tool that owns a foreign table, for UI messaging. */
export function detectTool(lowerNames: Set<string>): string | undefined {
  const has = (name: string) => lowerNames.has(name);
  if (has("version") && has("dirty")) return "golang-migrate";
  if (has("installed_rank") && has("checksum") && (has("script") || has("version"))) return "Flyway";
  if (has("md5sum") && has("author")) return "Liquibase";
  if (lowerNames.size === 1 && has("version")) return "Rails / ActiveRecord";
  return undefined;
}

/**
 * Classify a `schema_migrations` table from its columns:
 *  - absent: no such table (caller creates Mordor's own).
 *  - native: Mordor's own layout — full read/write.
 *  - adopted: a foreign row-per-migration table — read, and upsert by version.
 *  - adopted-readonly: golang-migrate's single current-version row — read only,
 *    never written, so we don't break its `SELECT … LIMIT 1`.
 *  - unusable: exists but has no recognisable version column.
 */
export function classifyColumns(columns: TrackingColumn[]): TrackingAdapter {
  if (columns.length === 0) return { kind: "absent" };
  const names = columns.map((c) => c.name);
  const lowerNames = new Set(columns.map((c) => c.name.toLowerCase()));

  if (REQUIRED_TRACKING_COLUMNS.every((column) => lowerNames.has(column))) {
    const versionType = columns.find((c) => c.name.toLowerCase() === "version")?.type ?? "text";
    return { kind: "ready", mode: "native", map: nativeMap(versionType), columns: names };
  }

  const map = resolveColumnMap(columns);
  if (!map) return { kind: "unusable", columns: names };

  // A `dirty` flag is golang-migrate's signature: it keeps exactly one row (the
  // current version). Writing per-migration rows would break it, so adopt it
  // read-only and let Mordor's own history remember what it applied.
  const mode: TrackingMode = lowerNames.has("dirty") ? "adopted-readonly" : "adopted";
  const tool = detectTool(lowerNames);
  return tool
    ? { kind: "ready", mode, map, columns: names, tool }
    : { kind: "ready", mode, map, columns: names };
}

/** Distinct physical columns to SELECT for a given map (version always included). */
export function uniqueColumns(map: TrackingColumnMap): string[] {
  const cols = [map.version, map.filename, map.checksum, map.appliedAt, map.success, map.errorMessage];
  return [...new Set(cols.filter((c): c is string => Boolean(c)))];
}

/** Bind a version value to the column's type — numeric tables want a number. */
export function bindVersion(version: string, versionType: string): string | number {
  if (NUMERIC_CQL_TYPES.has(versionType.toLowerCase()) && /^-?\d+$/.test(version)) {
    return Number(version);
  }
  return version;
}

function asAppliedAt(value: unknown): AppliedRow["applied_at"] {
  if (value == null) return null;
  if (value instanceof Date) return value;
  return String(value);
}

/** Normalise a raw table row into Mordor's AppliedRow via the column map. */
export function rowToApplied(
  version: string,
  row: Record<string, unknown>,
  map: TrackingColumnMap
): AppliedRow {
  const successRaw = map.success ? Boolean(row[map.success]) : true;
  return {
    version,
    filename: map.filename ? String(row[map.filename] ?? "") : "",
    checksum: map.checksum && row[map.checksum] != null ? String(row[map.checksum]) : null,
    applied_at: map.appliedAt ? asAppliedAt(row[map.appliedAt]) : null,
    success: map.successInverted ? !successRaw : successRaw,
    error_message: map.errorMessage && row[map.errorMessage] != null ? String(row[map.errorMessage]) : null
  };
}

/** Build the INSERT that records an apply, populating only the columns that exist. */
export function buildTrackingInsert(
  keyspace: string,
  map: TrackingColumnMap,
  entry: MigrationEntry,
  outcome: ApplyOutcome,
  now: Date
): { cql: string; params: unknown[] } {
  const cols: string[] = [map.version];
  const params: unknown[] = [bindVersion(entry.version, map.versionType)];
  if (map.filename) {
    cols.push(map.filename);
    params.push(entry.filename);
  }
  if (map.checksum) {
    cols.push(map.checksum);
    params.push(entry.checksum);
  }
  if (map.appliedAt) {
    cols.push(map.appliedAt);
    params.push(now);
  }
  if (map.success) {
    cols.push(map.success);
    params.push(map.successInverted ? !outcome.success : outcome.success);
  }
  if (map.errorMessage) {
    cols.push(map.errorMessage);
    params.push(outcome.error ?? null);
  }
  const columnList = cols.map(quoteIdent).join(", ");
  const placeholders = cols.map(() => "?").join(", ");
  return {
    cql: `INSERT INTO ${quoteIdent(keyspace)}.${TRACKING_TABLE} (${columnList}) VALUES (${placeholders})`,
    params
  };
}

/** The guided error shown when an existing table can't be used for tracking. */
export function unusableTrackingError(keyspace: string, columns: string[]): Error {
  const found = columns.length ? columns.join(", ") : "no columns";
  return new Error(
    `A "${TRACKING_TABLE}" table already exists in keyspace "${keyspace}", but Mordor couldn't find a ` +
      `version/identifier column to track migrations by (found: ${found}). Rename that table, or point ` +
      `this connection at a keyspace whose "${TRACKING_TABLE}" Mordor can manage.`
  );
}
