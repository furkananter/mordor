import type * as pg from "pg";
// `splitCqlStatements` is misleadingly named (Cassandra origin) but the
// algorithm — split on `;` outside `'...'` / `$$...$$` / line+block comments
// — is identical to what Postgres needs. The only Cassandra-specific branch
// (`BEGIN BATCH ... APPLY BATCH`) is keyword-gated and never triggers on real
// SQL scripts. Reused here pending a future move to a shared `core/sql/`
// helper when MongoDB lands and we generalize.
import { splitCqlStatements } from "../cassandra/cqlSplit";
import { ConnectionProfileWithPassword } from "../config/profile";
import type { SshTunnelManager } from "../db/sshTunnel";
import {
  ColumnMetadata,
  PreviewRowsPayload,
  QueryResultPayload,
  TableIdentity,
  TableSchemaPayload,
} from "../shared/messages";
import { PostgresSchemaNode } from "./types";
import { serializePostgresRows } from "./serialize";
import { runPostgresExport } from "./exporter";
import type { ExportResult } from "../export/types";

export interface PostgresSchemaScriptStatementResult {
  index: number;
  cql: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface PostgresSchemaScriptResult {
  totalStatements: number;
  statementsExecuted: number;
  durationMs: number;
  /** Always true for Postgres — only exists to match the Cassandra payload. */
  schemaAgreementOk: boolean;
  /**
   * True when the transaction was rolled back. The renderer uses this to
   * label per-statement ✓ marks as "attempted (rolled back)" — otherwise
   * users see ✓ alongside `0/N statements` and think the early statements
   * persisted when they didn't.
   */
  rolledBack?: boolean;
  statements: PostgresSchemaScriptStatementResult[];
  error?: string;
}

/**
 * pg is ~150 KB plus the libpq-style parsers — same lazy-load strategy as
 * cassandra-driver so a Mordor session that never touches a Postgres profile
 * doesn't pay the boot cost.
 */
let driverCache: typeof pg | undefined;
async function getDriver(): Promise<typeof pg> {
  if (!driverCache) driverCache = await import("pg");
  return driverCache;
}

interface ActiveConnection {
  profile: ConnectionProfileWithPassword;
  client: pg.Client;
  schemas: PostgresSchemaNode[];
}

/** Preview/page size for ad-hoc table browsing. */
export const POSTGRES_PREVIEW_LIMIT = 100;

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

/**
 * Schema prefixes we hide from the sidebar tree by default. These are
 * bookkeeping schemas owned by Postgres extensions (TimescaleDB chunks,
 * Supabase realtime/storage/auth, pg_partman) — the user typically only cares
 * about their own application schemas. Including them tanks the renderer:
 * a busy TimescaleDB instance can have thousands of `_hyper_*_*_chunk` tables
 * in `_timescaledb_internal`, and rendering every node turns every click into
 * a re-layout pass against a giant tree.
 */
const HIDDEN_SCHEMA_PREFIXES = [
  // TimescaleDB owns everything under `_timescaledb_*` (catalog, internal,
  // config, cache, functions). Matched as a prefix so future TimescaleDB
  // versions adding new internal schemas keep getting filtered.
  "_timescaledb_",
];

const HIDDEN_SCHEMA_NAMES = new Set([
  // Supabase / pg_graphql / pg_net / pg_cron internals.
  "_realtime",
  "_analytics",
  "pgsodium",
  "pgsodium_masks",
  "supabase_functions",
  "supabase_migrations",
  "graphql",
  "graphql_public",
  "net",
  "vault",
  // pg_partman bookkeeping.
  "partman",
]);

export class PostgresService {
  private readonly connections = new Map<string, ActiveConnection>();

  // Optional SSH tunnel manager — see CassandraService. When `profile.ssh` is
  // set, connect dials a local-forwarded port through the bastion instead of
  // the real host.
  constructor(private readonly sshTunnel?: SshTunnelManager) {}

  isConnected(profileId: string): boolean {
    return this.connections.has(profileId);
  }

  getSchemas(profileId: string): PostgresSchemaNode[] {
    return this.connections.get(profileId)?.schemas ?? [];
  }

  async connect(
    profile: ConnectionProfileWithPassword,
  ): Promise<PostgresSchemaNode[]> {
    if (profile.type !== "postgres") {
      throw new Error(`PostgresService received a ${profile.type} profile.`);
    }
    const existing = this.connections.get(profile.id);
    if (existing) return existing.schemas;

    // Open the SSH tunnel (if configured) and aim the pg client at the local
    // forwarded endpoint instead of the real host.
    let endpointOverride: { host: string; port: number } | undefined;
    if (profile.ssh && this.sshTunnel) {
      endpointOverride = await this.sshTunnel.open(profile.id, profile.ssh, {
        host: profile.host,
        port: profile.port,
      });
    }

    const driver = await getDriver();
    const client = new driver.Client(buildClientConfig(profile, endpointOverride));
    // Resolve the effective username for error messages. pg falls back to
    // `process.env.USER` when neither the config nor PGUSER is set, which
    // surprises everyone running a default Docker postgres ("why is it trying
    // to log in as my macOS account?"). We distinguish the three cases:
    //   - explicit user set on profile          → trust what pg actually sent
    //   - explicit empty string (trust auth)    → label it "(empty)" so the
    //                                             error doesn't lie about
    //                                             pg silently using OS user
    //   - undefined (field never set)           → pg falls back to env
    let effectiveUser: string;
    if (typeof profile.username === "string") {
      effectiveUser = profile.username === "" ? "(empty)" : profile.username;
    } else {
      effectiveUser = process.env["PGUSER"] || process.env["USER"] || "(default)";
    }

    let connected = false;
    try {
      await client.connect();
      connected = true;
      const schemas = await this.fetchSchema(client);
      this.connections.set(profile.id, { profile, client, schemas });
      return schemas;
    } catch (caught) {
      // Anything past this point means the cluster slot is not populated. If
      // we already authenticated (connect resolved) we must close the open
      // socket — otherwise the TCP/SCRAM session leaks until process exit.
      // Errors from end() are non-recoverable here; swallow them so we still
      // surface the original failure to the user.
      if (connected) {
        try {
          await client.end();
        } catch {
          // Nothing useful to do — original error is what the user needs to see.
        }
      }
      // Connect failed — tear down the bastion tunnel so it doesn't leak.
      if (profile.ssh && this.sshTunnel) await this.sshTunnel.close(profile.id);
      throw translateConnectError(caught, profile, effectiveUser);
    }
  }

  async disconnect(profileId: string): Promise<void> {
    const existing = this.connections.get(profileId);
    if (!existing) return;
    this.connections.delete(profileId);
    try {
      await existing.client.end();
    } catch {
      // Driver may already be closed; nothing to do.
    }
    if (existing.profile.ssh && this.sshTunnel) {
      await this.sshTunnel.close(profileId);
    }
  }

  async refreshSchema(profileId: string): Promise<PostgresSchemaNode[]> {
    const existing = this.requireConnection(profileId);
    const schemas = await this.fetchSchema(existing.client);
    existing.schemas = schemas;
    return schemas;
  }

  async fetchTableSchema(table: TableIdentity): Promise<TableSchemaPayload> {
    const existing = this.requireConnection(table.profileId);
    // information_schema.columns gives us name / type / nullability / position.
    // Primary key membership comes from pg_index + pg_attribute, joined via
    // the table's regclass. We compose both in one round-trip per table.
    const columnsResult = await existing.client.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      ordinal_position: number;
      is_nullable: "YES" | "NO";
    }>(
      `SELECT column_name, data_type, udt_name, ordinal_position, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [table.keyspace, table.table],
    );
    const pkResult = await existing.client.query<{ attname: string; pos: number }>(
      `SELECT a.attname, array_position(i.indkey, a.attnum) AS pos
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass
         AND i.indisprimary`,
      [table.keyspace, table.table],
    );
    const pkSet = new Set(pkResult.rows.map((row) => row.attname));
    const pkOrder = new Map(pkResult.rows.map((row) => [row.attname, row.pos] as const));

    const columns: ColumnMetadata[] = columnsResult.rows.map((row) => ({
      name: row.column_name,
      // Prefer the udt_name when data_type is generic ("USER-DEFINED",
      // "ARRAY", or one of the catalog-mapped names) so the user sees the
      // actual column type ("uuid", "int4", "text[]") instead of the broad
      // SQL standard label.
      type: normalizeType(row.data_type, row.udt_name),
      kind: pkSet.has(row.column_name) ? "partition_key" : "regular",
      position: pkSet.has(row.column_name) ? (pkOrder.get(row.column_name) ?? null) : null,
    }));

    return {
      table,
      columns,
      partitionKeys: pkResult.rows
        .slice()
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
        .map((row) => row.attname),
      clusteringKeys: [],
    };
  }

  async fetchPreviewRows(
    table: TableIdentity,
    pageState?: string,
  ): Promise<PreviewRowsPayload> {
    const existing = this.requireConnection(table.profileId);
    const offset = parsePageStateOffset(pageState);
    // Postgres has no opaque pageState token — we reuse the field to carry the
    // numeric OFFSET so the renderer's existing "load more" UI works without
    // knowing whether the DB is Cassandra or Postgres. OFFSET is O(n) at the
    // server; this is fine for the 100-row preview pages we ship in v1 but is
    // a known limitation. Keyset pagination is a follow-up once we surface PK
    // columns reliably.
    const result = await existing.client.query(
      `SELECT * FROM ${quoteQualified(table.keyspace, table.table)} LIMIT $1 OFFSET $2`,
      [POSTGRES_PREVIEW_LIMIT, offset],
    );
    const rawRows = result.rows as Array<Record<string, unknown>>;
    const columns = result.fields?.map((f) => f.name) ?? Object.keys(rawRows[0] ?? {});

    const payload: PreviewRowsPayload = {
      columns,
      rows: serializePostgresRows(rawRows),
      limit: POSTGRES_PREVIEW_LIMIT,
    };
    // Hand back the next-page token only when the server returned a full page;
    // a short page proves there's nothing more to fetch.
    if (rawRows.length === POSTGRES_PREVIEW_LIMIT) {
      payload.pageState = String(offset + POSTGRES_PREVIEW_LIMIT);
    }
    return payload;
  }

  async fetchTableDdl(table: TableIdentity): Promise<string> {
    const existing = this.requireConnection(table.profileId);
    // pg has no single `pg_get_tabledef` — we compose CREATE TABLE from the
    // catalog. v1 covers columns + nullability + primary key. Foreign keys,
    // indexes, defaults, and constraints are intentionally out of scope until
    // someone asks for them — getting them right requires several more joins
    // and they're rarely what a quick-look DDL is for.
    const columnsResult = await existing.client.query<{
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
      [table.keyspace, table.table],
    );
    if (columnsResult.rows.length === 0) {
      throw new Error(`Table ${table.keyspace}.${table.table} has no columns or does not exist.`);
    }
    const pkResult = await existing.client.query<{ attname: string }>(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = format('%I.%I', $1::text, $2::text)::regclass
         AND i.indisprimary
       ORDER BY array_position(i.indkey, a.attnum)`,
      [table.keyspace, table.table],
    );

    const lines = columnsResult.rows.map((row) => {
      const type = normalizeType(row.data_type, row.udt_name);
      const nullability = row.is_nullable === "NO" ? " NOT NULL" : "";
      const defaultClause = row.column_default ? ` DEFAULT ${row.column_default}` : "";
      return `  ${quoteIdent(row.column_name)} ${type}${nullability}${defaultClause}`;
    });

    let sql = `CREATE TABLE ${quoteQualified(table.keyspace, table.table)} (\n${lines.join(",\n")}`;
    if (pkResult.rows.length > 0) {
      sql += `,\n  PRIMARY KEY (${pkResult.rows.map((r) => quoteIdent(r.attname)).join(", ")})`;
    }
    sql += "\n);";
    return sql;
  }

  /**
   * Insert a single row from the schema-aware form. Only columns the user
   * filled are included, so columns with defaults (serial PKs, `now()`,
   * generated values) are left to the database. Values are bound as `$n`
   * parameters and the server casts each text parameter to its target column
   * type, so numbers/booleans/json columns work without manual quoting.
   */
  async insertRow(
    table: TableIdentity,
    values: Record<string, string>,
  ): Promise<{ inserted: number }> {
    const existing = this.requireConnection(table.profileId);
    const schema = await this.fetchTableSchema(table);
    const known = new Set(schema.columns.map((column) => column.name));
    const columns = Object.keys(values).filter(
      (column) => known.has(column) && (values[column] ?? "").trim() !== "",
    );
    if (columns.length === 0) {
      throw new Error("No column values provided to insert.");
    }
    const colList = columns.map((column) => quoteIdent(column)).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const params = columns.map((column) => values[column] ?? null);
    const sql = `INSERT INTO ${quoteQualified(table.keyspace, table.table)} (${colList}) VALUES (${placeholders})`;
    await existing.client.query(sql, params);
    return { inserted: 1 };
  }

  /**
   * Update a single existing row, identified by its original primary key values
   * (`keys`). Primary-key columns are kept read-only by the renderer, so only
   * non-key columns appear in `values`. An empty string clears the column to NULL,
   * matching the insert form's "blank = null" convention and the Cassandra path.
   */
  async updateRow(
    table: TableIdentity,
    keys: Record<string, string>,
    values: Record<string, string>,
  ): Promise<{ updated: number }> {
    const existing = this.requireConnection(table.profileId);
    const schema = await this.fetchTableSchema(table);
    const known = new Set(schema.columns.map((column) => column.name));
    const keyColumns = schema.partitionKeys;
    if (keyColumns.length === 0) {
      throw new Error(
        `Cannot update rows in ${table.keyspace}.${table.table}: no primary key found to identify the row.`,
      );
    }
    const keySet = new Set(keyColumns);
    const illegalKeyUpdates = Object.keys(values).filter((column) => keySet.has(column));
    if (illegalKeyUpdates.length > 0) {
      throw new Error(
        `Cannot update primary key column(s) — ${illegalKeyUpdates.join(", ")}.`,
      );
    }
    const unknownColumns = Object.keys(values).filter((column) => !known.has(column));
    if (unknownColumns.length > 0) {
      throw new Error(
        `Cannot update ${table.keyspace}.${table.table}: unknown column(s) — ${unknownColumns.join(", ")}. Refresh the schema and try again.`,
      );
    }
    const missingKeys = keyColumns.filter((column) => (keys[column] ?? "").trim() === "");
    if (missingKeys.length > 0) {
      throw new Error(
        `Cannot update ${table.keyspace}.${table.table}: primary key value(s) required to identify the row — ${missingKeys.join(", ")}.`,
      );
    }
    const setColumns = Object.keys(values);
    if (setColumns.length === 0) {
      throw new Error("No column changes to apply.");
    }
    const params: Array<string | null> = [];
    const setClause = setColumns
      .map((column) => {
        const raw = values[column] ?? "";
        params.push(raw === "" ? null : raw);
        return `${quoteIdent(column)} = $${params.length}`;
      })
      .join(", ");
    const whereClause = keyColumns
      .map((column) => {
        params.push(keys[column] ?? "");
        return `${quoteIdent(column)} = $${params.length}`;
      })
      .join(" AND ");
    const sql = `UPDATE ${quoteQualified(table.keyspace, table.table)} SET ${setClause} WHERE ${whereClause}`;
    const result = await existing.client.query(sql, params);
    // rowCount === 0 means the WHERE matched nothing — the row was deleted or
    // its key changed since the edit form was opened. Without this guard the
    // renderer would report a successful save for an UPDATE that did nothing.
    if (!result.rowCount) {
      throw new Error(
        `No matching row found in ${table.keyspace}.${table.table} — it may have been deleted or its key changed since you opened the editor. Refresh and try again.`,
      );
    }
    return { updated: result.rowCount };
  }

  /**
   * Delete one or more rows identified by their primary-key values. Each row in
   * `rows` must supply every primary-key column — non-key columns are ignored.
   * All deletes run inside a single transaction so the selection is removed
   * atomically: if any statement fails we ROLLBACK and nothing is deleted.
   * Mirrors the Cassandra `deleteRows` contract (reject empty/whitespace key
   * values; throw when the table has no primary key).
   */
  async deleteRows(
    table: TableIdentity,
    rows: Array<Record<string, string>>,
  ): Promise<{ deleted: number }> {
    if (rows.length === 0) return { deleted: 0 };
    const existing = this.requireConnection(table.profileId);
    const schema = await this.fetchTableSchema(table);
    const keyColumns = schema.partitionKeys;
    if (keyColumns.length === 0) {
      throw new Error(
        `Cannot delete rows from ${table.keyspace}.${table.table}: no primary key found to identify the row.`,
      );
    }
    const missing = rows
      .map((row, index) => ({ index, row }))
      .filter(({ row }) => keyColumns.some((column) => (row[column] ?? "").trim() === ""));
    if (missing.length > 0) {
      throw new Error(
        `Selected rows are missing primary key columns required for deletion (rows: ${missing
          .map(({ index }) => index + 1)
          .join(", ")}).`,
      );
    }
    const whereClause = keyColumns
      .map((column, index) => `${quoteIdent(column)} = $${index + 1}`)
      .join(" AND ");
    const sql = `DELETE FROM ${quoteQualified(table.keyspace, table.table)} WHERE ${whereClause}`;
    let deleted = 0;
    try {
      await existing.client.query("BEGIN");
      for (const row of rows) {
        const params = keyColumns.map((column) => row[column] ?? "");
        const result = await existing.client.query(sql, params);
        deleted += result.rowCount ?? 0;
      }
      await existing.client.query("COMMIT");
    } catch (error) {
      // Swallow any ROLLBACK failure so the original error (the real cause) is
      // the one rethrown — the connection may already be in a failed-tx state.
      // Mirrors the defensive rollback in runSchemaScript.
      try {
        await existing.client.query("ROLLBACK");
      } catch {
        // Nothing more we can do; surface the original failure.
      }
      throw error;
    }
    return { deleted };
  }

  async runSelectQuery(profileId: string, sql: string): Promise<QueryResultPayload> {
    const existing = this.requireConnection(profileId);
    // We don't impose a LIMIT here because pg respects the user's query as-is
    // and the renderer paginates the result client-side. If the query returns
    // millions of rows the user will feel it — that's an explicit ask, not a
    // surprise the workbench should swallow.
    const result = await existing.client.query(sql);
    const rawRows = (result.rows ?? []) as Array<Record<string, unknown>>;
    const columns = result.fields?.map((f) => f.name) ?? Object.keys(rawRows[0] ?? {});
    return {
      cql: sql,
      columns,
      rows: serializePostgresRows(rawRows),
      limit: POSTGRES_PREVIEW_LIMIT,
    };
  }

  /**
   * Apply a multi-statement DDL/DML script atomically. Unlike Cassandra (where
   * schema changes are non-transactional and a partial failure leaves halfway
   * state), Postgres wraps the whole script in a single transaction: on the
   * first statement that errors we ROLLBACK and the cluster reverts. The
   * statement-by-statement result mirrors Cassandra's `SchemaScriptResult`
   * so the renderer's ResultPanel works unchanged.
   *
   * Note: a few statements can't run inside a transaction (e.g. `CREATE INDEX
   * CONCURRENTLY`, `VACUUM`, `REINDEX`). Those throw `25001` and we surface
   * the server's error verbatim — the user can rerun outside the script form
   * via the SQL Console for now.
   */
  async runSchemaScript(profileId: string, sql: string): Promise<PostgresSchemaScriptResult> {
    const existing = this.requireConnection(profileId);
    const statements = splitCqlStatements(sql);
    const started = Date.now();
    const results: PostgresSchemaScriptStatementResult[] = [];
    let executed = 0;
    let firstError: string | undefined;

    // Drop any caller-supplied BEGIN/COMMIT/ROLLBACK — we own the transaction.
    // If we let one through, pg either nests (savepoint semantics, surprising)
    // or errors with "there is no transaction in progress". Either case makes
    // the rollback story incoherent, so we just strip them.
    const txControl = /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\b/i;
    const effective = statements.filter((statement) => !txControl.test(statement));

    try {
      await existing.client.query("BEGIN");
      for (let index = 0; index < effective.length; index += 1) {
        const statement = effective[index]!;
        const statementStarted = Date.now();
        try {
          await existing.client.query(statement);
          executed += 1;
          results.push({
            index: index + 1,
            cql: statement,
            ok: true,
            durationMs: Date.now() - statementStarted,
          });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : String(caught);
          firstError = `Statement ${index + 1}/${effective.length} failed: ${message}`;
          results.push({
            index: index + 1,
            cql: statement,
            ok: false,
            error: message,
            durationMs: Date.now() - statementStarted,
          });
          break;
        }
      }
      if (firstError) {
        await existing.client.query("ROLLBACK");
      } else {
        await existing.client.query("COMMIT");
      }
    } catch (caught) {
      // Tx control itself errored (rare — connection died mid-script). Try
      // a defensive rollback so the connection doesn't sit in failed-tx
      // state where every subsequent query errors with `25P02`.
      try {
        await existing.client.query("ROLLBACK");
      } catch {
        // Nothing more we can do.
      }
      throw caught;
    }

    const rolledBack = Boolean(firstError);
    const result: PostgresSchemaScriptResult = {
      totalStatements: effective.length,
      // Number of statements that DID land (post-COMMIT). On rollback this is
      // 0 because none persisted, even though earlier statements technically
      // ran inside the now-undone tx. The renderer combines this with
      // `rolledBack` to label per-statement ✓ marks as "attempted, rolled
      // back" instead of "succeeded".
      statementsExecuted: rolledBack ? 0 : executed,
      durationMs: Date.now() - started,
      schemaAgreementOk: true,
      statements: results,
    };
    if (rolledBack) result.rolledBack = true;
    if (firstError) result.error = firstError;
    return result;
  }

  async dispose(): Promise<void> {
    await Promise.all(
      Array.from(this.connections.keys(), (id) => this.disconnect(id)),
    );
  }

  /**
   * Export a single table — schema + rows — into a self-contained folder
   * under `outputDir`. The folder name is `mordor-pg-<slug>-<timestamp>` so
   * two exports never collide. Heavy lifting lives in `exporter.ts`; this
   * method is just a typed entry point.
   */
  async exportTable(
    profileId: string,
    schema: string,
    table: string,
    outputDir: string,
  ): Promise<ExportResult> {
    const conn = this.requireConnection(profileId);
    return runPostgresExport({
      profileId,
      profileName: conn.profile.name,
      client: conn.client,
      outputDir,
      schemaFilter: [schema],
      tableFilter: [{ schema, table }],
      scopeLabel: `table ${schema}.${table}`,
    });
  }

  /** Export every base table + view in a single schema. */
  async exportSchema(
    profileId: string,
    schema: string,
    outputDir: string,
  ): Promise<ExportResult> {
    const conn = this.requireConnection(profileId);
    return runPostgresExport({
      profileId,
      profileName: conn.profile.name,
      client: conn.client,
      outputDir,
      schemaFilter: [schema],
      scopeLabel: `schema ${schema}`,
    });
  }

  /** Export every non-system schema in the connected database. */
  async exportAll(profileId: string, outputDir: string): Promise<ExportResult> {
    const conn = this.requireConnection(profileId);
    return runPostgresExport({
      profileId,
      profileName: conn.profile.name,
      client: conn.client,
      outputDir,
      scopeLabel: `full database (${conn.profile.type === "postgres" ? conn.profile.database : ""})`,
    });
  }

  private async fetchSchema(client: pg.Client): Promise<PostgresSchemaNode[]> {
    // Two queries: one for user schemas (so empty ones like a fresh `public`
    // still show in the sidebar), one for the actual tables/views. Listing the
    // namespaces separately means the user sees "this DB has nothing yet"
    // instead of an empty sidebar that looks broken.
    //
    // Postgres-side filter only removes the `pg_*` and `information_schema`
    // built-ins. The extension-internal hide list is applied client-side via
    // `isHiddenSchemaName` — the earlier LIKE/ESCAPE approach worked on most
    // installs but had a known footgun on Postgres builds with
    // `standard_conforming_strings=off` (the backslash escape silently no-ops
    // and the filter does nothing). A plain JS prefix check has no such trap.
    const [namespacesResult, objectsResult] = await Promise.all([
      client.query<{ schema_name: string }>(
        `SELECT nspname AS schema_name
         FROM pg_namespace
         WHERE nspname NOT IN ('pg_catalog','information_schema','pg_toast')
           AND nspname NOT LIKE 'pg_temp_%'
           AND nspname NOT LIKE 'pg_toast_temp_%'
         ORDER BY nspname`,
      ),
      client.query<{
        schema_name: string;
        object_name: string;
        relkind: "r" | "p" | "v" | "m";
      }>(
        // pg_catalog.pg_class is the canonical source. `relkind`: r=table,
        // p=partitioned table, v=view, m=materialized view. We skip TOAST,
        // sequences, indexes, etc.
        `SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r','p','v','m')
           AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
           AND n.nspname NOT LIKE 'pg_temp_%'
           AND n.nspname NOT LIKE 'pg_toast_temp_%'
         ORDER BY n.nspname, c.relname`,
      ),
    ]);

    const bySchema = new Map<string, PostgresSchemaNode>();
    for (const row of namespacesResult.rows) {
      if (SYSTEM_SCHEMAS.has(row.schema_name)) continue;
      if (isHiddenSchemaName(row.schema_name)) continue;
      bySchema.set(row.schema_name, { name: row.schema_name, tables: [], views: [] });
    }
    for (const row of objectsResult.rows) {
      if (SYSTEM_SCHEMAS.has(row.schema_name)) continue;
      if (isHiddenSchemaName(row.schema_name)) continue;
      let entry = bySchema.get(row.schema_name);
      if (!entry) {
        entry = { name: row.schema_name, tables: [], views: [] };
        bySchema.set(row.schema_name, entry);
      }
      if (row.relkind === "v" || row.relkind === "m") {
        entry.views.push({ name: row.object_name, materialized: row.relkind === "m" });
      } else {
        entry.tables.push({ name: row.object_name });
      }
    }
    return Array.from(bySchema.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private requireConnection(profileId: string): ActiveConnection {
    const existing = this.connections.get(profileId);
    if (!existing) throw new Error("Postgres connection is not active.");
    return existing;
  }
}

/**
 * True when a schema name belongs to an extension's bookkeeping namespace —
 * the user almost never wants to see these in the sidebar tree. Exported for
 * the unit test that locks the TimescaleDB / Supabase / pg_partman list.
 */
export function isHiddenSchemaName(name: string): boolean {
  if (HIDDEN_SCHEMA_NAMES.has(name)) return true;
  for (const prefix of HIDDEN_SCHEMA_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

function buildClientConfig(
  profile: ConnectionProfileWithPassword,
  endpointOverride?: { host: string; port: number },
): pg.ClientConfig {
  if (profile.type !== "postgres") {
    throw new Error(`buildClientConfig called for non-postgres profile ${profile.id}.`);
  }
  const config: pg.ClientConfig = {
    // When tunnelled, connect to the local forwarded endpoint instead of the
    // real host/port (the SSH tunnel relays to the actual server).
    host: endpointOverride?.host ?? profile.host,
    port: endpointOverride?.port ?? profile.port,
    database: profile.database,
    // pg's SASL/SCRAM auth path crashes with "client password must be a string"
    // when this is undefined, even if the server is configured for trust auth
    // and the password is never needed. Always pass a string — an empty one
    // when the user didn't set one — so a real auth failure surfaces as a
    // readable server error instead of a stack trace from the driver.
    password: profile.password ?? "",
  };
  if (profile.username) config.user = profile.username;
  if (profile.useTls) {
    // `verify-full` and `verify-ca` aren't natively supported by node-pg's
    // `ssl` shape, so we map them onto rejectUnauthorized. A custom CA would
    // be a future setting. For v1 the choice is "strict TLS" (default when on)
    // or "encrypted but unverified" (explicit override via sslMode=require).
    const strict = profile.sslMode !== "require";
    config.ssl = { rejectUnauthorized: strict };
  }
  return config;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteQualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function parsePageStateOffset(pageState?: string): number {
  if (!pageState) return 0;
  const parsed = Number.parseInt(pageState, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeType(dataType: string, udtName: string): string {
  // "USER-DEFINED" hides enums/composites behind a generic label — the udt
  // name is the actual type. "ARRAY" same story (e.g. "_int4" → "int4[]").
  if (dataType === "USER-DEFINED") return udtName;
  if (dataType === "ARRAY") {
    return udtName.startsWith("_") ? `${udtName.slice(1)}[]` : `${udtName}[]`;
  }
  return dataType;
}

/**
 * Convert pg's raw connect errors into messages a user can act on. The driver
 * emits cryptic SCRAM details, Node syscall codes (ECONNREFUSED, ETIMEDOUT,
 * ENOTFOUND, EHOSTUNREACH), and bare SQLSTATEs — none of which suggest the
 * fix. We translate the cases that come up in practice and pass everything
 * else through unchanged so we never hide an error we don't recognize.
 */
function translateConnectError(
  caught: unknown,
  profile: { host: string; port: number; username?: string; database?: string },
  effectiveUser: string,
): Error {
  const message = caught instanceof Error ? caught.message : String(caught);
  // SASL/SCRAM crash → server requires a password we don't have.
  if (message.startsWith("SASL: SCRAM-SERVER-FIRST-MESSAGE")) {
    return new Error(
      `Postgres server at ${profile.host}:${profile.port} requires a password, ` +
      `but this profile has none set. Edit the connection and enter the password ` +
      `for user "${effectiveUser}", then connect again.`,
    );
  }
  // SQLSTATE 28P01 — server rejected credentials.
  const code = (caught as { code?: string })?.code;
  if (code === "28P01") {
    const detail = profile.username
      ? `Check the password on the profile.`
      : `The profile has no username set; pg defaulted to "${effectiveUser}". ` +
        `Edit the connection and set the username explicitly (e.g. "postgres").`;
    return new Error(
      `Authentication failed: Postgres rejected user "${effectiveUser}" at ` +
      `${profile.host}:${profile.port}. ${detail}`,
    );
  }
  // Node transport errors — TCP/DNS layer never made it to a Postgres handshake.
  if (code === "ECONNREFUSED") {
    return new Error(
      `Cannot reach Postgres at ${profile.host}:${profile.port} — connection refused. ` +
      `Is the server running and listening on this port?`,
    );
  }
  if (code === "ETIMEDOUT") {
    return new Error(
      `Connection to ${profile.host}:${profile.port} timed out. ` +
      `Check the host, port, and any firewall/VPN between you and the server.`,
    );
  }
  if (code === "ENOTFOUND") {
    return new Error(
      `Host "${profile.host}" could not be resolved. Check the hostname for typos.`,
    );
  }
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
    return new Error(
      `Network is unreachable for ${profile.host}:${profile.port}. ` +
      `Check your connectivity (VPN, network, routing).`,
    );
  }
  // Database doesn't exist (3D000) — pg's default message is fine but we
  // surface the database name to save the user a step.
  if (code === "3D000") {
    return new Error(
      `Postgres database "${profile.database}" does not exist on ${profile.host}:${profile.port}. ` +
      `Create it or edit the profile's database field.`,
    );
  }
  // Unknown — re-throw as-is so we never accidentally swallow context.
  return caught instanceof Error ? caught : new Error(message);
}
