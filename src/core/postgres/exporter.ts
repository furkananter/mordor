/**
 * Postgres export orchestration. Lives in its own file (not on
 * `PostgresService`) so the service stays focused on connection lifecycle
 * and ad-hoc queries — exports are a long-running, file-IO-heavy operation
 * with its own concerns (cursors, paging caps, manifest authoring).
 *
 * Layered responsibility:
 *
 *   1. Catalog reads          — list schemas/tables/columns; build a
 *                               `PostgresExportTable[]` plan.
 *   2. SQL string rendering   — handled in `exportRenderer.ts`.
 *   3. Streaming row fetch    — `DECLARE CURSOR ... FETCH 1000` so we don't
 *                               buffer the entire table in main-process RAM.
 *   4. File writes            — open per-artifact write streams once; never
 *                               accumulate the whole dump in memory.
 *   5. Manifest + README      — record what we did, what we skipped, and how
 *                               to replay it.
 *
 * Public surface is a single function `runPostgresExport()` — the service
 * methods (exportTable / exportSchema / exportAll) only resolve which tables
 * go into the plan and forward the rest.
 */

import type * as pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import {
  EXPORT_BATCH_SIZE,
  EXPORT_ROW_CAP,
  ExportArtifact,
  ExportResult,
  ExportTableSummary,
} from "../export/types";
import { csvRow, folderSlug, quoteIdent, timestampSuffix } from "../export/formatters";
import {
  PostgresExportTable,
  pgLiteral,
  renderInsert,
  renderSchemaScript,
} from "./export-renderer";

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

export interface PostgresExporterContext {
  profileId: string;
  profileName: string;
  client: pg.Client;
  /** Output directory the user picked. The exporter creates a uniquely-named
   *  subfolder beneath this so two consecutive exports never collide. */
  outputDir: string;
  /** When set, restrict the export to these schema names (case-sensitive). */
  schemaFilter?: ReadonlyArray<string>;
  /** When set, restrict further to these qualified table names. */
  tableFilter?: ReadonlyArray<{ schema: string; table: string }>;
  /** Human label for the manifest (e.g. "full database", "schema public",
   *  "table public.orders"). */
  scopeLabel: string;
}

export async function runPostgresExport(ctx: PostgresExporterContext): Promise<ExportResult> {
  const started = Date.now();
  const warnings: string[] = [];

  const plan = await loadExportPlan(ctx);
  if (plan.length === 0) {
    warnings.push(
      `No tables matched the requested scope (${ctx.scopeLabel}). The export folder will only contain the schema script and README.`,
    );
  }

  // Resolve the per-export subfolder name. Slug the profile, append UTC
  // timestamp — `mordor-pg-<profile>-<YYYYMMDD-HHmmss>`.
  const folderName = `mordor-pg-${folderSlug(ctx.profileName)}-${timestampSuffix()}`;
  const folderPath = join(ctx.outputDir, folderName);
  await mkdir(folderPath, { recursive: true });
  await mkdir(join(folderPath, "data"), { recursive: true });

  const artifacts: ExportArtifact[] = [];
  const tableSummaries: ExportTableSummary[] = [];

  // Schema script first — written in one shot since it's the smallest file
  // (one CREATE per table; almost always under a few hundred KB).
  const schemaScript = renderSchemaScript(groupBySchema(plan));
  const schemaPath = join(folderPath, "schema.sql");
  await writeFile(schemaPath, schemaScript, "utf8");
  artifacts.push({ relativePath: "schema.sql", byteCount: Buffer.byteLength(schemaScript, "utf8") });

  // Data script (data.sql) — INSERT statements, opened streaming because for
  // a real database this is the biggest file by far.
  const dataPath = join(folderPath, "data.sql");
  const dataStream = createWriteStream(dataPath, { encoding: "utf8" });
  await writeLine(dataStream, "-- Mordor export: data");
  await writeLine(dataStream, `-- Source: ${ctx.profileName} (${ctx.scopeLabel})`);
  await writeLine(dataStream, "-- Replay: psql -f data.sql -d <target-db>");
  await writeLine(dataStream, "");

  let totalRows = 0;
  for (const table of plan) {
    if (table.kind !== "BASE TABLE") {
      // Views don't get data — their definition lives in schema.sql.
      tableSummaries.push({
        keyspace: table.schema,
        table: table.name,
        rowsExported: 0,
        truncated: false,
      });
      continue;
    }
    await writeLine(dataStream, `-- Table ${quoteIdent(table.schema)}.${quoteIdent(table.name)}`);
    const tableArtifacts: ExportArtifact[] = [];
    const summary = await exportTableData(ctx, table, dataStream, folderPath, tableArtifacts, warnings);
    artifacts.push(...tableArtifacts);
    tableSummaries.push(summary);
    totalRows += summary.rowsExported;
    await writeLine(dataStream, "");
  }
  await closeStream(dataStream);
  const dataBytes = await byteSize(dataPath);
  artifacts.push({ relativePath: "data.sql", byteCount: dataBytes });

  // README + manifest last so they can reference the actual artifact list.
  const readme = renderReadme(ctx, plan, tableSummaries, warnings);
  await writeFile(join(folderPath, "README.md"), readme, "utf8");
  artifacts.push({ relativePath: "README.md", byteCount: Buffer.byteLength(readme, "utf8") });

  const manifest = buildManifest({
    engine: "postgres",
    scopeLabel: ctx.scopeLabel,
    profileName: ctx.profileName,
    plan,
    tableSummaries,
    artifacts,
    warnings,
    totalRows,
    startedAt: started,
  });
  await writeFile(join(folderPath, "manifest.json"), manifest, "utf8");
  artifacts.push({ relativePath: "manifest.json", byteCount: Buffer.byteLength(manifest, "utf8") });

  return {
    folderPath,
    durationMs: Date.now() - started,
    engine: "postgres",
    artifacts,
    tables: tableSummaries,
    warnings,
  };
}

/**
 * Stream one table's rows: writes INSERT statements to `dataStream` and a
 * sibling CSV file under `<folder>/data/<schema>.<table>.csv`. Returns the
 * row count + truncation flag for the manifest.
 */
async function exportTableData(
  ctx: PostgresExporterContext,
  table: PostgresExportTable,
  dataStream: WriteStream,
  folderPath: string,
  artifactsOut: ExportArtifact[],
  warningsOut: string[],
): Promise<ExportTableSummary> {
  const csvRelative = `data/${table.schema}.${table.name}.csv`;
  const csvPath = join(folderPath, csvRelative);
  const csvStream = createWriteStream(csvPath, { encoding: "utf8" });
  await writeChunk(csvStream, csvRow(table.columns.map((c) => c.name)));

  let rowCount = 0;
  let truncated = false;
  const cursorName = `mordor_export_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const fq = `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;

  // Cursor lives inside a transaction. `WITHOUT HOLD` is the default — we
  // close + commit before returning, so the cursor can't outlive the tx.
  try {
    await ctx.client.query("BEGIN READ ONLY");
    await ctx.client.query(`DECLARE ${cursorName} NO SCROLL CURSOR FOR SELECT * FROM ${fq}`);

    while (rowCount < EXPORT_ROW_CAP) {
      const remaining = EXPORT_ROW_CAP - rowCount;
      const batch = Math.min(EXPORT_BATCH_SIZE, remaining);
      const result = await ctx.client.query(`FETCH ${batch} FROM ${cursorName}`);
      const rows = result.rows as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      for (const row of rows) {
        await writeLine(dataStream, renderInsert(table, row));
        await writeChunk(csvStream, csvRow(table.columns.map((c) => csvCell(row[c.name], c))));
      }
      rowCount += rows.length;
      if (rows.length < batch) break;
    }
    // Drain check — were we capped before EOF? Try one more 1-row fetch; if
    // it succeeds the table is bigger than the cap and we mark it truncated.
    if (rowCount >= EXPORT_ROW_CAP) {
      const probe = await ctx.client.query(`FETCH 1 FROM ${cursorName}`);
      if ((probe.rows ?? []).length > 0) {
        truncated = true;
        warningsOut.push(
          `Table ${table.schema}.${table.name} hit the ${EXPORT_ROW_CAP.toLocaleString()}-row export cap; remaining rows were not written.`,
        );
      }
    }
  } finally {
    try {
      await ctx.client.query(`CLOSE ${cursorName}`);
    } catch {
      // Cursor may already be gone if the tx rolled back; nothing to do.
    }
    try {
      await ctx.client.query("COMMIT");
    } catch {
      try {
        await ctx.client.query("ROLLBACK");
      } catch {
        // We're done either way; the next caller will reopen if needed.
      }
    }
  }
  await closeStream(csvStream);
  const csvBytes = await byteSize(csvPath);
  artifactsOut.push({ relativePath: csvRelative, byteCount: csvBytes });

  return {
    keyspace: table.schema,
    table: table.name,
    rowsExported: rowCount,
    truncated,
  };
}

/**
 * Build a `PostgresExportTable[]` plan from the live catalog, respecting the
 * filters passed in. Two queries (columns + PKs) per table is enough for the
 * shape we render; we deliberately don't load FKs/indexes/etc. (v1 scope).
 */
async function loadExportPlan(ctx: PostgresExporterContext): Promise<PostgresExportTable[]> {
  const { client } = ctx;

  // Object list: tables + views + materialized views, with the view
  // definition baked in so we don't need a second round-trip.
  const objectsResult = await client.query<{
    schema_name: string;
    object_name: string;
    relkind: "r" | "p" | "v" | "m";
    view_def: string | null;
  }>(
    `SELECT n.nspname AS schema_name,
            c.relname  AS object_name,
            c.relkind,
            pg_get_viewdef(c.oid, true) AS view_def
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v','m')
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       AND n.nspname NOT LIKE 'pg_temp_%'
       AND n.nspname NOT LIKE 'pg_toast_temp_%'
     ORDER BY n.nspname, c.relname`,
  );

  const objects = objectsResult.rows.filter((row) => {
    if (SYSTEM_SCHEMAS.has(row.schema_name)) return false;
    if (ctx.schemaFilter && !ctx.schemaFilter.includes(row.schema_name)) return false;
    if (
      ctx.tableFilter &&
      !ctx.tableFilter.some((t) => t.schema === row.schema_name && t.table === row.object_name)
    ) {
      return false;
    }
    return true;
  });

  if (objects.length === 0) return [];

  // Per-table columns + primary keys. Issued in parallel for throughput; for
  // typical OLTP DBs (dozens of tables) this is a few hundred ms total.
  const tables = await Promise.all(
    objects.map(async (row) => {
      const [columnsResult, pkResult] = await Promise.all([
        client.query<{
          column_name: string;
          data_type: string;
          udt_name: string;
          is_nullable: "YES" | "NO";
          column_default: string | null;
        }>(
          `SELECT column_name, data_type, udt_name, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [row.schema_name, row.object_name],
        ),
        client.query<{ attname: string }>(
          `SELECT a.attname
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
           WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass
             AND i.indisprimary
           ORDER BY array_position(i.indkey, a.attnum)`,
          [row.schema_name, row.object_name],
        ),
      ]);
      const table: PostgresExportTable = {
        schema: row.schema_name,
        name: row.object_name,
        kind: row.relkind === "v" ? "VIEW" : row.relkind === "m" ? "MATERIALIZED VIEW" : "BASE TABLE",
        columns: columnsResult.rows.map((col) => ({
          name: col.column_name,
          dataType: col.data_type,
          udtName: col.udt_name,
          isNullable: col.is_nullable === "YES",
          columnDefault: col.column_default,
        })),
        primaryKey: pkResult.rows.map((r) => r.attname),
      };
      if ((row.relkind === "v" || row.relkind === "m") && row.view_def) {
        // exactOptionalPropertyTypes is on — only assign when we actually
        // have a definition string. `?? undefined` would still trip the
        // checker because `undefined` is not a member of `string`.
        table.viewDefinition = row.view_def;
      }
      return table;
    }),
  );

  return tables;
}

function groupBySchema(tables: ReadonlyArray<PostgresExportTable>) {
  const map = new Map<string, PostgresExportTable[]>();
  for (const table of tables) {
    const bucket = map.get(table.schema) ?? [];
    bucket.push(table);
    map.set(table.schema, bucket);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ts]) => ({ name, tables: ts }));
}

function csvCell(value: unknown, _column: PostgresExportTable["columns"][number]): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  // For arrays/objects fall back to the SQL literal — at least it round-trips
  // when somebody re-imports the CSV into the SAME schema.
  return pgLiteral(value);
}

function renderReadme(
  ctx: PostgresExporterContext,
  plan: ReadonlyArray<PostgresExportTable>,
  summaries: ReadonlyArray<ExportTableSummary>,
  warnings: ReadonlyArray<string>,
): string {
  const totalRows = summaries.reduce((sum, s) => sum + s.rowsExported, 0);
  const baseTables = plan.filter((t) => t.kind === "BASE TABLE").length;
  const views = plan.length - baseTables;
  const lines = [
    `# Mordor export — Postgres`,
    "",
    `**Source:** ${ctx.profileName}`,
    `**Scope:** ${ctx.scopeLabel}`,
    `**Tables:** ${baseTables} base, ${views} view${views === 1 ? "" : "s"}`,
    `**Rows:** ${totalRows.toLocaleString()}`,
    "",
    `## Restore`,
    "",
    "```sh",
    "createdb <target-db>             # or use an existing empty database",
    "psql -d <target-db> -f schema.sql",
    "psql -d <target-db> -f data.sql",
    "```",
    "",
    `## Files`,
    "",
    "- `schema.sql` — `CREATE SCHEMA` + `CREATE TABLE` + `CREATE VIEW` (one statement each).",
    "- `data.sql` — one `INSERT` per row, grouped per table.",
    "- `data/<schema>.<table>.csv` — per-table CSV (UTF-8, RFC 4180).",
    "- `manifest.json` — machine-readable export summary.",
    "",
    `## Known limitations`,
    "",
    "- Foreign keys, indexes (beyond the primary key), `CHECK` constraints,",
    "  triggers, sequences, comments, ownership, and grants are **not** included.",
    "- Per-table row cap: " + EXPORT_ROW_CAP.toLocaleString() + ". Tables that hit",
    "  the cap are flagged in `manifest.json` and listed below.",
    "- Custom types (enums, composites) are emitted as quoted identifiers; the",
    "  restore target must already define them in a compatible search_path.",
    "",
  ];
  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildManifest(input: {
  engine: "postgres" | "cassandra" | "redis";
  scopeLabel: string;
  profileName: string;
  plan: ReadonlyArray<PostgresExportTable>;
  tableSummaries: ReadonlyArray<ExportTableSummary>;
  artifacts: ReadonlyArray<ExportArtifact>;
  warnings: ReadonlyArray<string>;
  totalRows: number;
  startedAt: number;
}): string {
  const manifest = {
    engine: input.engine,
    schemaVersion: 1,
    generator: "mordor",
    scope: input.scopeLabel,
    profileName: input.profileName,
    startedAtIso: new Date(input.startedAt).toISOString(),
    finishedAtIso: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    totals: {
      tables: input.plan.length,
      baseTables: input.plan.filter((t) => t.kind === "BASE TABLE").length,
      views: input.plan.filter((t) => t.kind !== "BASE TABLE").length,
      rows: input.totalRows,
    },
    tables: input.tableSummaries,
    artifacts: input.artifacts,
    warnings: input.warnings,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// -------- streaming helpers ---------------------------------------------------

function writeChunk(stream: WriteStream, chunk: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // write() returns false when the internal buffer is full; respect
    // backpressure so a multi-GB dump doesn't blow node's heap. The 'drain'
    // event fires when it's safe to write again.
    const ok = stream.write(chunk, "utf8", (err) => (err ? reject(err) : resolve()));
    if (!ok) {
      stream.once("drain", () => undefined);
    }
  });
}

function writeLine(stream: WriteStream, line: string): Promise<void> {
  return writeChunk(stream, `${line}\n`);
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

async function byteSize(path: string): Promise<number> {
  const { stat } = await import("node:fs/promises");
  const info = await stat(path);
  return info.size;
}
