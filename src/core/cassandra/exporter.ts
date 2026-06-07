/**
 * Cassandra export orchestration. Mirrors `postgres/exporter.ts` but uses the
 * cassandra-driver's pageState pagination (no transactions, no cursors) and
 * pulls schema from `system_schema.*` tables.
 */

import type * as cassandra from "cassandra-driver";
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
  CassandraExportColumn,
  CassandraExportKeyspace,
  CassandraExportTable,
  cqlLiteral,
  renderInsert,
  renderSchemaScript,
} from "./export-renderer";

const SYSTEM_KEYSPACES = new Set([
  "system",
  "system_auth",
  "system_distributed",
  "system_schema",
  "system_traces",
  "system_views",
  "system_virtual_schema",
]);

export interface CassandraExporterContext {
  profileId: string;
  profileName: string;
  client: cassandra.Client;
  outputDir: string;
  keyspaceFilter?: ReadonlyArray<string>;
  tableFilter?: ReadonlyArray<{ keyspace: string; table: string }>;
  scopeLabel: string;
}

export async function runCassandraExport(
  ctx: CassandraExporterContext,
): Promise<ExportResult> {
  const started = Date.now();
  const warnings: string[] = [];

  const keyspaces = await loadExportPlan(ctx, warnings);
  if (keyspaces.length === 0) {
    warnings.push(
      `No keyspaces matched the requested scope (${ctx.scopeLabel}). The export folder will only contain the README.`,
    );
  }

  const folderName = `mordor-cassandra-${folderSlug(ctx.profileName)}-${timestampSuffix()}`;
  const folderPath = join(ctx.outputDir, folderName);
  await mkdir(folderPath, { recursive: true });
  await mkdir(join(folderPath, "data"), { recursive: true });

  const artifacts: ExportArtifact[] = [];
  const tableSummaries: ExportTableSummary[] = [];

  // Schema script — every CREATE KEYSPACE + CREATE TABLE in one shot.
  const schemaScript = renderSchemaScript(keyspaces);
  const schemaPath = join(folderPath, "schema.cql");
  await writeFile(schemaPath, schemaScript, "utf8");
  artifacts.push({ relativePath: "schema.cql", byteCount: Buffer.byteLength(schemaScript, "utf8") });

  // Data script + per-table CSVs.
  const dataPath = join(folderPath, "data.cql");
  const dataStream = createWriteStream(dataPath, { encoding: "utf8" });
  await writeLine(dataStream, "-- Mordor export: Cassandra data");
  await writeLine(dataStream, `-- Source: ${ctx.profileName} (${ctx.scopeLabel})`);
  await writeLine(dataStream, "-- Replay: cqlsh -f data.cql");
  await writeLine(dataStream, "");

  let totalRows = 0;
  for (const keyspace of keyspaces) {
    for (const table of keyspace.tables) {
      await writeLine(dataStream, `-- Table ${quoteIdent(keyspace.name)}.${quoteIdent(table.name)}`);
      const summary = await exportTableData(ctx, table, dataStream, folderPath, artifacts, warnings);
      tableSummaries.push(summary);
      totalRows += summary.rowsExported;
      await writeLine(dataStream, "");
    }
  }
  await closeStream(dataStream);
  artifacts.push({ relativePath: "data.cql", byteCount: await byteSize(dataPath) });

  const readme = renderReadme(ctx, keyspaces, tableSummaries, warnings);
  await writeFile(join(folderPath, "README.md"), readme, "utf8");
  artifacts.push({ relativePath: "README.md", byteCount: Buffer.byteLength(readme, "utf8") });

  const manifest = buildManifest({
    scopeLabel: ctx.scopeLabel,
    profileName: ctx.profileName,
    keyspaces,
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
    engine: "cassandra",
    artifacts,
    tables: tableSummaries,
    warnings,
  };
}

async function exportTableData(
  ctx: CassandraExporterContext,
  table: CassandraExportTable,
  dataStream: WriteStream,
  folderPath: string,
  artifactsOut: ExportArtifact[],
  warningsOut: string[],
): Promise<ExportTableSummary> {
  const csvRelative = `data/${table.keyspace}.${table.name}.csv`;
  const csvPath = join(folderPath, csvRelative);
  const csvStream = createWriteStream(csvPath, { encoding: "utf8" });
  await writeChunk(csvStream, csvRow(table.columns.map((c) => c.name)));

  let rowCount = 0;
  let pageState: string | undefined;
  let truncated = false;

  // Cassandra paging — fetchSize controls how many rows the driver loads per
  // round-trip; pageState is the opaque continuation token returned with each
  // page. Loop until empty pageState (= EOF) or the row cap.
  do {
    const remaining = EXPORT_ROW_CAP - rowCount;
    const fetchSize = Math.min(EXPORT_BATCH_SIZE, remaining);
    const options: cassandra.QueryOptions = { prepare: true, fetchSize };
    if (pageState) options.pageState = pageState;
    const result = await ctx.client.execute(
      `SELECT * FROM ${quoteIdent(table.keyspace)}.${quoteIdent(table.name)}`,
      [],
      options,
    );
    const rows = (result.rows ?? []).map(
      (row) => ({ ...(row as unknown as Record<string, unknown>) }),
    );
    for (const row of rows) {
      const stmt = renderInsert(table, row);
      if (stmt) {
        await writeLine(dataStream, stmt);
      }
      await writeChunk(
        csvStream,
        csvRow(table.columns.map((c) => csvCell(row[c.name]))),
      );
    }
    rowCount += rows.length;
    pageState = result.pageState ?? undefined;
  } while (pageState && rowCount < EXPORT_ROW_CAP);

  if (pageState && rowCount >= EXPORT_ROW_CAP) {
    truncated = true;
    warningsOut.push(
      `Table ${table.keyspace}.${table.name} hit the ${EXPORT_ROW_CAP.toLocaleString()}-row export cap; remaining rows were not written.`,
    );
  }

  await closeStream(csvStream);
  artifactsOut.push({ relativePath: csvRelative, byteCount: await byteSize(csvPath) });

  return {
    keyspace: table.keyspace,
    table: table.name,
    rowsExported: rowCount,
    truncated,
  };
}

/**
 * Discover keyspaces + tables + columns from system_schema. Three queries
 * (keyspaces, tables, columns) — issued sequentially because column counts
 * are unbounded and we want a stable failure mode rather than parallel
 * pressure on the cluster's coordinator.
 */
async function loadExportPlan(
  ctx: CassandraExporterContext,
  _warningsOut: string[],
): Promise<CassandraExportKeyspace[]> {
  const { client } = ctx;

  interface KsRow {
    keyspace_name: string;
    durable_writes: boolean;
    replication: Record<string, string>;
  }
  interface TableRow {
    keyspace_name: string;
    table_name: string;
  }
  interface ColRow {
    keyspace_name: string;
    table_name: string;
    column_name: string;
    type: string;
    kind: CassandraExportColumn["kind"];
    position: number | null;
    clustering_order: "asc" | "desc" | "none" | null;
  }

  const [ksResult, tableResult, colResult] = await Promise.all([
    client.execute("SELECT keyspace_name, durable_writes, replication FROM system_schema.keyspaces"),
    client.execute("SELECT keyspace_name, table_name FROM system_schema.tables"),
    client.execute(
      "SELECT keyspace_name, table_name, column_name, type, kind, position, clustering_order FROM system_schema.columns",
    ),
  ]);

  const allowedKeyspaces = (name: string) => {
    if (SYSTEM_KEYSPACES.has(name)) return false;
    if (ctx.keyspaceFilter && !ctx.keyspaceFilter.includes(name)) return false;
    return true;
  };
  const allowedTable = (keyspace: string, table: string) => {
    if (!allowedKeyspaces(keyspace)) return false;
    if (
      ctx.tableFilter &&
      !ctx.tableFilter.some((t) => t.keyspace === keyspace && t.table === table)
    ) {
      return false;
    }
    return true;
  };

  const tableColumns = new Map<string, CassandraExportColumn[]>();
  for (const row of colResult.rows as unknown as ColRow[]) {
    if (!allowedTable(row.keyspace_name, row.table_name)) continue;
    const key = `${row.keyspace_name} ${row.table_name}`;
    const bucket = tableColumns.get(key) ?? [];
    const col: CassandraExportColumn = {
      name: row.column_name,
      type: row.type,
      kind: row.kind,
      position: row.position,
    };
    if (row.clustering_order !== null && row.clustering_order !== undefined) {
      col.clusteringOrder = row.clustering_order;
    }
    bucket.push(col);
    tableColumns.set(key, bucket);
  }

  const tablesByKeyspace = new Map<string, CassandraExportTable[]>();
  for (const row of tableResult.rows as unknown as TableRow[]) {
    if (!allowedTable(row.keyspace_name, row.table_name)) continue;
    const cols = tableColumns.get(`${row.keyspace_name} ${row.table_name}`) ?? [];
    if (cols.length === 0) continue;
    const bucket = tablesByKeyspace.get(row.keyspace_name) ?? [];
    bucket.push({ keyspace: row.keyspace_name, name: row.table_name, columns: cols });
    tablesByKeyspace.set(row.keyspace_name, bucket);
  }

  const result: CassandraExportKeyspace[] = [];
  for (const row of ksResult.rows as unknown as KsRow[]) {
    if (!allowedKeyspaces(row.keyspace_name)) continue;
    const tables = (tablesByKeyspace.get(row.keyspace_name) ?? []).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    if (tables.length === 0 && ctx.tableFilter) continue;
    result.push({
      name: row.keyspace_name,
      replication: row.replication ?? { class: "org.apache.cassandra.locator.SimpleStrategy", replication_factor: "1" },
      durableWrites: row.durable_writes,
      tables,
    });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}`;
  // For non-scalar Cassandra values (list/set/map/UDT) fall back to the CQL
  // literal — matches what's in data.cql so a round-trip read of the CSV +
  // schema would behave consistently.
  return cqlLiteral(value, "text");
}

function renderReadme(
  ctx: CassandraExporterContext,
  keyspaces: ReadonlyArray<CassandraExportKeyspace>,
  summaries: ReadonlyArray<ExportTableSummary>,
  warnings: ReadonlyArray<string>,
): string {
  const totalRows = summaries.reduce((sum, s) => sum + s.rowsExported, 0);
  const tableCount = summaries.length;
  const lines = [
    `# Mordor export — Cassandra`,
    "",
    `**Source:** ${ctx.profileName}`,
    `**Scope:** ${ctx.scopeLabel}`,
    `**Keyspaces:** ${keyspaces.length}`,
    `**Tables:** ${tableCount}`,
    `**Rows:** ${totalRows.toLocaleString()}`,
    "",
    `## Restore`,
    "",
    "```sh",
    "cqlsh -f schema.cql        # creates keyspaces + tables",
    "cqlsh -f data.cql          # populates rows",
    "```",
    "",
    `## Files`,
    "",
    "- `schema.cql` — `CREATE KEYSPACE` + `CREATE TABLE` (one statement each).",
    "- `data.cql` — one `INSERT` per row, grouped per table.",
    "- `data/<keyspace>.<table>.csv` — per-table CSV (UTF-8, RFC 4180).",
    "- `manifest.json` — machine-readable export summary.",
    "",
    `## Known limitations`,
    "",
    "- User-defined types (UDTs) and functions (UDFs) are not extracted; tables",
    "  that use them will fail to restore unless the UDTs are pre-created.",
    "- Secondary indexes, materialized views, per-table options (TTL, GC grace,",
    "  compaction, compression), and CDC settings are not included.",
    "- Per-table row cap: " + EXPORT_ROW_CAP.toLocaleString() + ". Tables that hit",
    "  the cap are flagged in `manifest.json` and listed below.",
    "- Counter columns export via plain `INSERT`; on restore the values will be",
    "  set rather than incremented (the math is wrong if you re-import on top",
    "  of an existing counter).",
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
  scopeLabel: string;
  profileName: string;
  keyspaces: ReadonlyArray<CassandraExportKeyspace>;
  tableSummaries: ReadonlyArray<ExportTableSummary>;
  artifacts: ReadonlyArray<ExportArtifact>;
  warnings: ReadonlyArray<string>;
  totalRows: number;
  startedAt: number;
}): string {
  const manifest = {
    engine: "cassandra",
    schemaVersion: 1,
    generator: "mordor",
    scope: input.scopeLabel,
    profileName: input.profileName,
    startedAtIso: new Date(input.startedAt).toISOString(),
    finishedAtIso: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    totals: {
      keyspaces: input.keyspaces.length,
      tables: input.tableSummaries.length,
      rows: input.totalRows,
    },
    keyspaces: input.keyspaces.map((k) => ({
      name: k.name,
      replication: k.replication,
      durableWrites: k.durableWrites,
      tables: k.tables.map((t) => t.name),
    })),
    tables: input.tableSummaries,
    artifacts: input.artifacts,
    warnings: input.warnings,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// -------- streaming helpers (identical to postgres/exporter.ts) -------------

function writeChunk(stream: WriteStream, chunk: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ok = stream.write(chunk, "utf8", (err) => (err ? reject(err) : resolve()));
    if (!ok) stream.once("drain", () => undefined);
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
