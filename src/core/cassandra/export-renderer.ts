/**
 * Cassandra (CQL) export renderer — pure functions that produce a replayable
 * CQL script from schema metadata + raw driver row values.
 *
 * What it covers:
 *
 *   - `CREATE KEYSPACE ... WITH replication = { ... }` (SimpleStrategy with
 *     RF=1 by default; the original keyspace's strategy is reflected when we
 *     know it).
 *   - `CREATE TABLE` with full primary key syntax — partition keys in their
 *     own tuple, clustering keys flat, `WITH CLUSTERING ORDER BY (...)`.
 *   - Static column qualifier.
 *   - Per-row INSERT statements using the column list (covers tables whose
 *     columns differ row-to-row, e.g. wide rows with sparse populations).
 *
 * What it deliberately drops (and the README lists explicitly):
 *
 *   - User-defined types (UDTs)        — fall back to JSON text.
 *   - User-defined functions (UDFs).
 *   - Secondary indexes, materialized views, custom CDC, compression options.
 *   - Per-table options (TTL, GC grace, compaction strategy).
 *
 * Restore is `cqlsh -f schema.cql && cqlsh -f data.cql` against an empty
 * cluster (or one with the keyspaces dropped first). The README in every
 * export folder spells this out.
 */

import { quoteIdent, quoteSqlString } from "../export/formatters";

export interface CassandraExportColumn {
  name: string;
  type: string;
  kind: "partition_key" | "clustering" | "static" | "regular";
  position: number | null;
  clusteringOrder?: "asc" | "desc" | "none" | null;
}

export interface CassandraExportTable {
  keyspace: string;
  name: string;
  columns: CassandraExportColumn[];
}

export interface CassandraExportKeyspace {
  name: string;
  /** Verbatim replication map from system_schema.keyspaces (already JSON-ish). */
  replication: Record<string, string>;
  durableWrites: boolean;
  tables: CassandraExportTable[];
}

export function renderSchemaScript(keyspaces: ReadonlyArray<CassandraExportKeyspace>): string {
  const lines: string[] = [
    "-- Mordor export: Cassandra schema",
    "-- Generated with Mordor (https://github.com/furkananter/mordor).",
    "-- Replay: cqlsh -f schema.cql",
    "",
  ];
  for (const ks of keyspaces) {
    lines.push(renderCreateKeyspace(ks));
    lines.push("");
    for (const table of ks.tables) {
      lines.push(renderCreateTable(table));
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function renderCreateKeyspace(ks: CassandraExportKeyspace): string {
  // The replication map is rendered with single-quoted keys + values per CQL
  // grammar. Numbers (replication factor) stay unquoted; everything else
  // gets quoted so SimpleStrategy / NetworkTopologyStrategy / per-DC RFs all
  // round-trip.
  const entries = Object.entries(ks.replication).map(([k, v]) => {
    const valueText = /^\d+$/.test(v) ? v : quoteSqlString(v);
    return `${quoteSqlString(k)}: ${valueText}`;
  });
  let stmt = `CREATE KEYSPACE IF NOT EXISTS ${quoteIdent(ks.name)}\n`;
  stmt += `  WITH replication = { ${entries.join(", ")} }`;
  if (!ks.durableWrites) {
    stmt += `\n   AND durable_writes = false`;
  }
  return `${stmt};`;
}

export function renderCreateTable(table: CassandraExportTable): string {
  const fq = `${quoteIdent(table.keyspace)}.${quoteIdent(table.name)}`;
  const partition = table.columns
    .filter((c) => c.kind === "partition_key")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const clustering = table.columns
    .filter((c) => c.kind === "clustering")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const others = table.columns
    .filter((c) => c.kind === "static" || c.kind === "regular")
    .sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...partition, ...clustering, ...others];

  const columnLines = ordered.map((column) => {
    const staticTag = column.kind === "static" ? " STATIC" : "";
    return `  ${quoteIdent(column.name)} ${column.type}${staticTag}`;
  });

  // Primary key clause — compound partition key gets its own tuple; single
  // partition key is bare. Clustering columns trail the partition tuple.
  const pkSegment = (() => {
    const partitionTuple =
      partition.length === 1
        ? quoteIdent(partition[0]!.name)
        : `(${partition.map((c) => quoteIdent(c.name)).join(", ")})`;
    if (clustering.length === 0) return partitionTuple;
    const clusteringCols = clustering.map((c) => quoteIdent(c.name)).join(", ");
    return `${partitionTuple}, ${clusteringCols}`;
  })();

  let cql = `CREATE TABLE IF NOT EXISTS ${fq} (\n`;
  cql += columnLines.join(",\n");
  cql += `,\n  PRIMARY KEY (${pkSegment})\n)`;

  // Honor clustering order when at least one clustering column has a non-
  // default direction. Otherwise we omit the clause and let the server
  // default to ascending.
  const hasOrder = clustering.some((c) => c.clusteringOrder && c.clusteringOrder !== "none");
  if (hasOrder) {
    const order = clustering
      .map((c) => `${quoteIdent(c.name)} ${(c.clusteringOrder ?? "asc").toUpperCase()}`)
      .join(", ");
    cql += `\n  WITH CLUSTERING ORDER BY (${order})`;
  }
  return `${cql};`;
}

/**
 * Render a single INSERT row. Unlike SQL we use the explicit column list
 * (`INSERT INTO ks.t (a,b,c) VALUES (...)`) because CQL is column-order
 * agnostic — driver row objects don't guarantee key ordering and a positional
 * INSERT would silently misalign for any change in column count.
 */
export function renderInsert(
  table: CassandraExportTable,
  row: Record<string, unknown>,
): string {
  const fq = `${quoteIdent(table.keyspace)}.${quoteIdent(table.name)}`;
  // Only include columns that are present in this row. Cassandra wide rows
  // legitimately omit columns; emitting NULL for everything missing would
  // bloat the script and lose semantic information (NULL means tombstone).
  const presentColumns = table.columns.filter((c) => row[c.name] !== undefined);
  if (presentColumns.length === 0) {
    // Tombstone row — nothing to insert. Skip.
    return "";
  }
  const cols = presentColumns.map((c) => quoteIdent(c.name)).join(", ");
  const vals = presentColumns.map((c) => cqlLiteral(row[c.name], c.type)).join(", ");
  return `INSERT INTO ${fq} (${cols}) VALUES (${vals});`;
}

/**
 * Convert a JS value pulled from the cassandra-driver into a CQL literal.
 * The driver exposes wrapper classes (Uuid, Long, LocalDate, BigDecimal,
 * InetAddress) — we detect them via `toString()` since constructor names
 * aren't stable through minification (same trick as `serializeCell`).
 *
 * Type-specific notes:
 *   - uuid / timeuuid → bare value, no quotes (CQL grammar accepts them this way)
 *   - blob            → 0x<hex>
 *   - timestamp       → 'YYYY-MM-DDTHH:MM:SS.sssZ' (quoted string; driver parses ISO)
 *   - text / varchar  → quoted, doubled internal single quotes
 *   - int / float etc → bare numeric literal
 *   - bool            → true / false (lowercase, per CQL convention)
 *   - list<T>         → [v1, v2, ...]
 *   - set<T>          → {v1, v2, ...}
 *   - map<K,V>        → {k1: v1, k2: v2}
 */
export function cqlLiteral(value: unknown, cqlType: string): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    // CQL timestamp accepts ISO-8601 in single quotes.
    return quoteSqlString(value.toISOString());
  }
  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }
  if (Array.isArray(value)) {
    // For list<T> use square brackets; the driver returns arrays for list.
    // (Sets come back as JS Set, handled below.) Element types are unknown
    // here unless the cqlType parses out — fall back to recursive default.
    const inner = inferCollectionInner(cqlType);
    return `[${value.map((entry) => cqlLiteral(entry, inner)).join(", ")}]`;
  }
  if (value instanceof Set) {
    const inner = inferCollectionInner(cqlType);
    return `{${Array.from(value, (entry) => cqlLiteral(entry, inner)).join(", ")}}`;
  }
  if (value instanceof Map) {
    const { key: keyType, val: valType } = inferMapInner(cqlType);
    const entries = Array.from(value, ([k, v]) => `${cqlLiteral(k, keyType)}: ${cqlLiteral(v, valType)}`);
    return `{${entries.join(", ")}}`;
  }
  if (typeof value === "object") {
    // Driver wrappers (Uuid, Long, BigDecimal, LocalDate, InetAddress).
    // toString() yields the canonical CQL representation for all of these.
    const str = (value as { toString?: () => string }).toString?.();
    if (typeof str === "string" && str.length > 0 && !str.startsWith("[object ")) {
      // UUIDs + numeric wrappers are bare; everything else quoted (date,
      // inet) to be safe.
      const lowerType = cqlType.toLowerCase();
      if (
        lowerType === "uuid" ||
        lowerType === "timeuuid" ||
        lowerType === "bigint" ||
        lowerType === "varint" ||
        lowerType === "decimal" ||
        lowerType === "double" ||
        lowerType === "float" ||
        lowerType === "int" ||
        lowerType === "smallint" ||
        lowerType === "tinyint" ||
        lowerType === "counter"
      ) {
        return str;
      }
      return quoteSqlString(str);
    }
    // Composite / UDT — best effort JSON, quoted.
    try {
      return quoteSqlString(JSON.stringify(value));
    } catch {
      return quoteSqlString(String(value));
    }
  }
  if (typeof value === "string") {
    return quoteSqlString(value);
  }
  return quoteSqlString(String(value));
}

/** Pull the element type from `list<T>` / `set<T>` / `frozen<list<T>>` etc. */
function inferCollectionInner(cqlType: string): string {
  const match = /<([^<>]+)>/.exec(cqlType);
  return match ? match[1]!.trim() : "text";
}

/** Pull key + value types from `map<K, V>` (handles nested generics shallowly). */
function inferMapInner(cqlType: string): { key: string; val: string } {
  const match = /map<\s*([^,]+),\s*(.+?)>/i.exec(cqlType);
  if (!match) return { key: "text", val: "text" };
  return { key: match[1]!.trim(), val: match[2]!.trim() };
}
