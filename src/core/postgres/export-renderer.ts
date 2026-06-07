/**
 * Postgres export renderer — pure functions that turn schema metadata + raw
 * pg row values into a replayable SQL script.
 *
 * Design notes:
 *
 *   - Output is `psql`-ingestible. A user can `psql -f schema.sql && psql -f
 *     data.sql` and get back a working database. No engine-specific extras
 *     (no SET / SELECT pg_catalog.set_config — keeps the dump portable).
 *
 *   - The renderer is intentionally lossy on a few well-known fronts. v1
 *     captures columns + types + nullability + defaults + primary keys.
 *     Foreign keys, indexes (beyond PK), CHECK constraints, sequences,
 *     triggers, comments, ownership, and grants are deliberately out of scope
 *     — getting them right requires ~8 more catalog joins per table and
 *     they're rarely what a "make a copy of this DB" export is for. The README
 *     in every export folder lists what's covered vs. dropped so the user
 *     isn't surprised.
 *
 *   - Identifier quoting is unconditional — `"public"."orders"` even when the
 *     name is a bare lowercase ASCII word. Costs nothing, prevents the entire
 *     class of "what if a column is named `user`?" bugs on restore.
 *
 *   - Values are serialized via `pgLiteral()` below. The contract is: round-
 *     trips identically through `INSERT ... VALUES(...)` for every pg type
 *     `node-pg` is willing to hand us as a JS value (text, int*, float*, bool,
 *     numeric/decimal, uuid, json/jsonb, date/timestamp, bytea, array of any
 *     of the above). Custom enums + composite types are emitted as text casts
 *     (`'value'::"schema"."enum_name"`) so the restore picks up the right
 *     type without us having to re-introspect on read.
 */

import { quoteIdent, quoteSqlString } from "../export/formatters";

export interface PostgresExportColumn {
  name: string;
  /** Already-normalized type ("text", "int4", "uuid", "tsvector", "_int4"). */
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
}

export interface PostgresExportTable {
  schema: string;
  name: string;
  columns: PostgresExportColumn[];
  /** Ordered list of PK column names; empty for tables with no primary key. */
  primaryKey: string[];
  /** Either "BASE TABLE", "VIEW", or "MATERIALIZED VIEW". Only base tables get data dumps. */
  kind: "BASE TABLE" | "VIEW" | "MATERIALIZED VIEW";
  /** For views: the SELECT definition. */
  viewDefinition?: string;
}

/**
 * CREATE SCHEMA + every table/view's CREATE statement, in dependency-safe
 * order (schemas first, then BASE tables, then views — views may reference
 * the tables above them).
 */
export function renderSchemaScript(
  schemas: ReadonlyArray<{ name: string; tables: PostgresExportTable[] }>,
): string {
  const lines: string[] = [
    "-- Mordor export: schema",
    "-- Generated with Mordor (https://github.com/furkananter/mordor).",
    "-- Replay: psql -f schema.sql -d <target-db>",
    "",
  ];
  for (const schema of schemas) {
    lines.push(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema.name)};`);
  }
  if (schemas.length > 0) lines.push("");

  const baseTables = schemas.flatMap((s) => s.tables.filter((t) => t.kind === "BASE TABLE"));
  const views = schemas.flatMap((s) => s.tables.filter((t) => t.kind !== "BASE TABLE"));

  for (const table of baseTables) {
    lines.push(renderCreateTable(table));
    lines.push("");
  }
  for (const view of views) {
    lines.push(renderCreateView(view));
    lines.push("");
  }
  return lines.join("\n");
}

export function renderCreateTable(table: PostgresExportTable): string {
  const fq = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
  const columnLines = table.columns.map((column) => {
    const type = pgColumnTypeText(column);
    const nullable = column.isNullable ? "" : " NOT NULL";
    // Defaults that reference sequences (`nextval('foo_id_seq'::regclass)`)
    // are emitted verbatim — restore creates the sequence implicitly via
    // SERIAL/IDENTITY rewriting only if the user transforms upstream. Out of
    // scope for v1; we document the limitation in the README.
    const defaultClause = column.columnDefault ? ` DEFAULT ${column.columnDefault}` : "";
    return `  ${quoteIdent(column.name)} ${type}${nullable}${defaultClause}`;
  });
  let sql = `CREATE TABLE IF NOT EXISTS ${fq} (\n${columnLines.join(",\n")}`;
  if (table.primaryKey.length > 0) {
    sql += `,\n  PRIMARY KEY (${table.primaryKey.map(quoteIdent).join(", ")})`;
  }
  sql += "\n);";
  return sql;
}

export function renderCreateView(view: PostgresExportTable): string {
  const fq = `${quoteIdent(view.schema)}.${quoteIdent(view.name)}`;
  const keyword = view.kind === "MATERIALIZED VIEW" ? "MATERIALIZED VIEW" : "VIEW";
  const body = view.viewDefinition?.trim() ?? "SELECT NULL WHERE FALSE";
  // Strip trailing semicolons so we don't end up with `...;;` after we append
  // our own terminator.
  const cleaned = body.replace(/;+\s*$/u, "");
  return `CREATE OR REPLACE ${keyword} ${fq} AS\n${cleaned};`;
}

/**
 * One INSERT per row. Multi-row INSERTs would be more compact but harder to
 * resume from a partial restore (one bad row aborts the whole statement); we
 * favor row-per-statement for survivability.
 */
export function renderInsert(
  table: PostgresExportTable,
  row: Record<string, unknown>,
): string {
  const fq = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
  const cols = table.columns.map((c) => quoteIdent(c.name)).join(", ");
  const vals = table.columns.map((c) => pgLiteral(row[c.name], c)).join(", ");
  return `INSERT INTO ${fq} (${cols}) VALUES (${vals});`;
}

/**
 * Pretty type name for the CREATE column line. Arrays get `[]` syntax;
 * USER-DEFINED uses the udt name as a quoted identifier so enums survive.
 */
function pgColumnTypeText(column: PostgresExportColumn): string {
  if (column.dataType === "USER-DEFINED") {
    // Enum types are schema-qualified in pg_type but we only have the udt
    // name. Restore tolerates a search_path lookup, so a bare quoted ident
    // works in 99% of cases (failure mode: enum defined in a non-default
    // schema, listed in README as a known gap).
    return quoteIdent(column.udtName);
  }
  if (column.dataType === "ARRAY") {
    const elementType = column.udtName.startsWith("_") ? column.udtName.slice(1) : column.udtName;
    return `${elementType}[]`;
  }
  return column.dataType;
}

/**
 * Render a JS value as a Postgres SQL literal suitable for INSERT VALUES().
 *
 * Type fidelity rules:
 *   - null / undefined        → NULL
 *   - boolean                 → TRUE / FALSE
 *   - number                  → as-is (handles ints + floats; Infinity/NaN
 *                                quoted as 'Infinity'/'NaN' per pg's spelling)
 *   - bigint                  → as-is (string form; pg parses it for int8)
 *   - Date                    → 'ISO'::timestamptz
 *   - Buffer                  → '\xhex'::bytea
 *   - string                  → quoted, double-quote escape
 *   - Array                   → '{...}' postgres array literal, recursively quoted
 *   - object (JSONB/composite)→ '...'::jsonb (or column type cast)
 */
export function pgLiteral(value: unknown, column?: PostgresExportColumn): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "'NaN'::float8";
    if (!Number.isFinite(value)) return value > 0 ? "'Infinity'::float8" : "'-Infinity'::float8";
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    return `${quoteSqlString(value.toISOString())}::timestamptz`;
  }
  if (Buffer.isBuffer(value)) {
    // bytea hex format. Note the doubled backslash — pg expects `\x...` but
    // SQL string literal eats one backslash unless `standard_conforming_strings=on`
    // (default since 9.1). We rely on the default; restoring against an
    // ancient pg with the off-default would need `E'\\\\x...'`.
    return `'\\x${value.toString("hex")}'::bytea`;
  }
  if (Array.isArray(value)) {
    return renderPostgresArrayLiteral(value);
  }
  if (typeof value === "object") {
    // JSON/JSONB/composite — round-trip via JSON.stringify and cast to jsonb.
    // If we know the column type is `json` (not jsonb), cast accordingly so
    // the original ordering/whitespace expectation is preserved (jsonb is
    // canonicalized server-side; json isn't).
    const json = JSON.stringify(value);
    const cast = column?.udtName === "json" ? "json" : "jsonb";
    return `${quoteSqlString(json)}::${cast}`;
  }
  // Strings: enum cast when we know the column type, plain quoted otherwise.
  const text = String(value);
  if (column?.dataType === "USER-DEFINED") {
    return `${quoteSqlString(text)}::${quoteIdent(column.udtName)}`;
  }
  return quoteSqlString(text);
}

/**
 * Format a JS array as a Postgres array literal: `'{a,"b,c",NULL}'`.
 * Elements are recursively formatted via `arrayElement()` which uses the
 * Postgres array-element quoting rules (double-quote, backslash-escape).
 */
function renderPostgresArrayLiteral(value: readonly unknown[]): string {
  const parts = value.map(arrayElement);
  return `'{${parts.join(",")}}'`;
}

function arrayElement(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "t" : "f";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return `"${value.toISOString()}"`;
  if (Buffer.isBuffer(value)) return `"\\\\x${value.toString("hex")}"`;
  if (Array.isArray(value)) {
    // Nested array — pg writes nested arrays inline (`{{1,2},{3,4}}`); the
    // outer literal already accounted for the wrapping single quotes.
    return `{${value.map(arrayElement).join(",")}}`;
  }
  if (typeof value === "object") {
    // Composite/JSON-in-array: serialize as JSON, escape for array literal.
    const json = JSON.stringify(value);
    return `"${json.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  const str = String(value);
  // pg's array literal grammar: bare tokens allowed if they contain no
  // comma/braces/quotes/whitespace/backslash and aren't NULL. Safer to always
  // quote — round-trip is identical and the parser is unambiguous.
  return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
