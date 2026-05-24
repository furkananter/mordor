import type * as cassandra from "cassandra-driver";
import {
  ColumnMetadata,
  QueryResultPayload,
  TableIdentity,
  TableSchemaPayload,
} from "../shared/messages";

/**
 * cassandra-driver is ~5 MB of CommonJS — eagerly requiring it at module load
 * time added a noticeable beat to the main process startup before the window
 * even appears. We defer the import to the first method that actually needs
 * the runtime (typically `connect`). After that first load, the module is
 * cached and helpers can grab it synchronously via `driverSync()`. Type-only
 * references stay free because they're erased by tsc.
 */
let driverCache: typeof cassandra | undefined;
async function getDriver(): Promise<typeof cassandra> {
  if (!driverCache) driverCache = await import("cassandra-driver");
  return driverCache;
}
function driverSync(): typeof cassandra {
  if (!driverCache) {
    throw new Error(
      "cassandra-driver requested before any connection was established — call connect() first.",
    );
  }
  return driverCache;
}
import { ConnectionProfileWithPassword } from "../config/profile";
import { buildTablePreviewQuery, previewLimit, quoteIdentifier } from "./cql";
import { splitCqlStatements } from "./cqlSplit";
import { isSchemaChange, waitForSchemaAgreement } from "./migrations/MigrationExecutor";
import { normalizeQuery, QueryMode } from "./query";
import { serializeRows } from "./serialize";

export interface SchemaScriptStatementResult {
  index: number;
  cql: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface SchemaScriptResult {
  totalStatements: number;
  statementsExecuted: number;
  durationMs: number;
  schemaAgreementOk: boolean;
  statements: SchemaScriptStatementResult[];
  error?: string;
}

export interface KeyspaceNode {
  name: string;
  tables: TableNode[];
}

export interface TableNode {
  name: string;
}

interface ActiveConnection {
  profile: ConnectionProfileWithPassword;
  client: cassandra.Client;
  schema: KeyspaceNode[];
}

interface SystemTableRow {
  keyspace_name: string;
  table_name: string;
}

interface SystemColumnRow {
  column_name: string;
  type: string;
  kind: ColumnMetadata["kind"];
  position: number | null;
}

const systemKeyspaces = new Set([
  "system",
  "system_auth",
  "system_distributed",
  "system_schema",
  "system_traces",
  "system_views",
  "system_virtual_schema",
]);

export class CassandraService {
  private readonly connections = new Map<string, ActiveConnection>();

  isConnected(profileId: string): boolean {
    return this.connections.has(profileId);
  }

  getClient(profileId: string): cassandra.Client {
    return this.requireConnection(profileId).client;
  }

  getSchema(profileId: string): KeyspaceNode[] {
    return this.connections.get(profileId)?.schema ?? [];
  }

  async connect(
    profile: ConnectionProfileWithPassword,
  ): Promise<KeyspaceNode[]> {
    if (profile.type !== "cassandra") {
      throw new Error(`CassandraService received a ${profile.type} profile.`);
    }
    const existing = this.connections.get(profile.id);
    if (existing) {
      return existing.schema;
    }

    const clientOptions: cassandra.ClientOptions = {
      contactPoints: profile.contactPoints,
      localDataCenter: profile.localDataCenter,
      protocolOptions: {
        port: profile.port,
      },
    };

    if (profile.keyspace) {
      clientOptions.keyspace = profile.keyspace;
    }

    const driver = await getDriver();

    if (profile.username && profile.password) {
      clientOptions.authProvider = new driver.auth.PlainTextAuthProvider(
        profile.username,
        profile.password,
      );
    }

    if (profile.useTls) {
      clientOptions.sslOptions = {};
    }

    const client = new driver.Client(clientOptions);

    await client.connect();
    const schema = await this.fetchSchema(client);
    this.connections.set(profile.id, { profile, client, schema });
    return schema;
  }

  async disconnect(profileId: string): Promise<void> {
    const existing = this.connections.get(profileId);
    if (!existing) {
      return;
    }

    this.connections.delete(profileId);
    await existing.client.shutdown();
  }

  async refreshSchema(profileId: string): Promise<KeyspaceNode[]> {
    const existing = this.requireConnection(profileId);
    const schema = await this.fetchSchema(existing.client);
    existing.schema = schema;
    return schema;
  }

  async fetchTableSchema(table: TableIdentity): Promise<TableSchemaPayload> {
    const existing = this.requireConnection(table.profileId);
    const result = await existing.client.execute(
      "SELECT column_name, type, kind, position FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
      [table.keyspace, table.table],
      { prepare: true },
    );

    const columns = result.rows
      .map((row) => normalizeColumnRow(row as unknown as SystemColumnRow))
      .sort(compareColumns);

    return {
      table,
      columns,
      partitionKeys: columns
        .filter((column) => column.kind === "partition_key")
        .map((column) => column.name),
      clusteringKeys: columns
        .filter((column) => column.kind === "clustering")
        .map((column) => column.name),
    };
  }

  async fetchPreviewRows(
    table: TableIdentity,
    pageState?: string,
  ): Promise<{
    columns: string[];
    rows: Record<string, string>[];
    limit: number;
    pageState?: string;
  }> {
    const existing = this.requireConnection(table.profileId);
    const query = buildTablePreviewQuery(table.keyspace, table.table);
    const options: cassandra.QueryOptions = {
      prepare: true,
      fetchSize: previewLimit,
    };
    // Forward the previous page's continuation token when paging through a
    // large table. Cassandra returns `result.pageState === null` (or empty)
    // when the final page is reached.
    if (pageState) options.pageState = pageState;

    const result = await existing.client.execute(query, [], options);
    const rawRows = result.rows.map((row) => ({
      ...(row as unknown as Record<string, unknown>),
    }));
    const columns =
      result.columns?.map((column) => column.name) ??
      Object.keys(rawRows[0] ?? {});

    const payload: {
      columns: string[];
      rows: Record<string, string>[];
      limit: number;
      pageState?: string;
    } = {
      columns,
      rows: serializeRows(rawRows),
      limit: previewLimit,
    };
    if (result.pageState) payload.pageState = result.pageState;
    return payload;
  }

  async fetchTableDdl(table: TableIdentity): Promise<string> {
    const existing = this.requireConnection(table.profileId);
    // Read all column metadata to reconstruct the CREATE TABLE statement.
    const columnsResult = await existing.client.execute(
      "SELECT column_name, type, kind, position, clustering_order FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
      [table.keyspace, table.table],
      { prepare: true },
    );
    interface ColumnRow {
      column_name: string;
      type: string;
      kind: ColumnMetadata["kind"];
      position: number | null;
      clustering_order: "asc" | "desc" | "none" | null;
    }
    const rows = columnsResult.rows.map((row) => row as unknown as ColumnRow);
    if (rows.length === 0) {
      throw new Error(`Table ${table.keyspace}.${table.table} has no columns or does not exist.`);
    }
    const partitionKeys = rows
      .filter((row) => row.kind === "partition_key")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const clusteringKeys = rows
      .filter((row) => row.kind === "clustering")
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const otherColumns = rows
      .filter((row) => row.kind !== "partition_key" && row.kind !== "clustering")
      .sort((a, b) => a.column_name.localeCompare(b.column_name));
    const orderedColumns = [...partitionKeys, ...clusteringKeys, ...otherColumns];

    const columnLines = orderedColumns.map((row) => {
      const staticTag = row.kind === "static" ? " STATIC" : "";
      return `  ${quoteIdentifier(row.column_name)} ${row.type}${staticTag}`;
    });

    const pkSegment = partitionKeys.length === 1 && clusteringKeys.length === 0
      ? quoteIdentifier(partitionKeys[0]!.column_name)
      : (() => {
          const partitionTuple = partitionKeys.length === 1
            ? quoteIdentifier(partitionKeys[0]!.column_name)
            : `(${partitionKeys.map((row) => quoteIdentifier(row.column_name)).join(", ")})`;
          const clusteringCols = clusteringKeys.map((row) => quoteIdentifier(row.column_name)).join(", ");
          return clusteringCols ? `(${partitionTuple}, ${clusteringCols})` : `(${partitionTuple})`;
        })();

    let cql = `CREATE TABLE ${quoteIdentifier(table.keyspace)}.${quoteIdentifier(table.table)} (\n`;
    cql += columnLines.join(",\n");
    cql += `,\n  PRIMARY KEY (${pkSegment})\n)`;

    if (clusteringKeys.some((row) => row.clustering_order && row.clustering_order !== "none")) {
      const order = clusteringKeys
        .map((row) => `${quoteIdentifier(row.column_name)} ${(row.clustering_order ?? "asc").toUpperCase()}`)
        .join(", ");
      cql += ` WITH CLUSTERING ORDER BY (${order})`;
    }
    return `${cql};`;
  }

  async runSchemaScript(profileId: string, cql: string): Promise<SchemaScriptResult> {
    const existing = this.requireConnection(profileId);
    const statements = splitCqlStatements(cql);
    const started = Date.now();
    const results: SchemaScriptStatementResult[] = [];
    let executed = 0;
    let schemaAgreementOk = true;
    let firstError: string | undefined;

    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]!;
      const statementStarted = Date.now();
      try {
        await existing.client.execute(statement);
        executed += 1;
        results.push({
          index: index + 1,
          cql: statement,
          ok: true,
          durationMs: Date.now() - statementStarted
        });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        firstError = `Statement ${index + 1}/${statements.length} failed: ${message}`;
        results.push({
          index: index + 1,
          cql: statement,
          ok: false,
          error: message,
          durationMs: Date.now() - statementStarted
        });
        break;
      }
      if (isSchemaChange(statement)) {
        const agreed = await waitForSchemaAgreement(existing.client);
        if (!agreed) schemaAgreementOk = false;
      }
    }

    const result: SchemaScriptResult = {
      totalStatements: statements.length,
      statementsExecuted: executed,
      durationMs: Date.now() - started,
      schemaAgreementOk,
      statements: results
    };
    if (firstError) result.error = firstError;
    return result;
  }

  async deleteRows(
    table: TableIdentity,
    rows: Array<Record<string, string>>,
  ): Promise<{ deleted: number }> {
    if (rows.length === 0) return { deleted: 0 };
    const existing = this.requireConnection(table.profileId);
    const schema = await this.fetchTableSchema(table);
    const keyColumns = [...schema.partitionKeys, ...schema.clusteringKeys];
    if (keyColumns.length === 0) {
      throw new Error(
        `Cannot delete rows from ${table.keyspace}.${table.table}: no primary key columns found.`,
      );
    }
    const missing = rows
      .map((row, index) => ({ index, row }))
      .filter(({ row }) => keyColumns.some((column) => row[column] === undefined || row[column] === ""));
    if (missing.length > 0) {
      throw new Error(
        `Selected rows are missing primary key columns required for deletion (rows: ${missing
          .map(({ index }) => index + 1)
          .join(", ")}).`,
      );
    }
    const typeByColumn = new Map(schema.columns.map((column) => [column.name, column.type]));
    const whereClause = keyColumns.map((column) => `"${column}" = ?`).join(" AND ");
    const cql = `DELETE FROM "${table.keyspace}"."${table.table}" WHERE ${whereClause}`;
    const queries = rows.map((row) => ({
      query: cql,
      params: keyColumns.map((column) => coerceForCassandra(row[column] ?? "", typeByColumn.get(column) ?? "text")),
    }));
    await existing.client.batch(queries, { prepare: true, logged: true });
    return { deleted: rows.length };
  }

  async runSelectQuery(
    profileId: string,
    cql: string,
    mode: QueryMode = "read",
  ): Promise<QueryResultPayload> {
    const existing = this.requireConnection(profileId);
    const normalized = normalizeQuery(cql, mode);
    const executeOptions: cassandra.QueryOptions = { prepare: true };
    if (normalized.isSelect) executeOptions.fetchSize = normalized.limit;
    const result = await existing.client.execute(normalized.cql, [], executeOptions);
    const rawRows = result.rows
      ? result.rows.map((row) => ({ ...(row as unknown as Record<string, unknown>) }))
      : [];
    const columns =
      result.columns?.map((column) => column.name) ??
      Object.keys(rawRows[0] ?? {});

    return {
      cql: normalized.cql,
      columns,
      rows: serializeRows(rawRows),
      limit: normalized.limit,
    };
  }

  /**
   * Opens a short-lived secondary client pinned to `keyspace` and runs `fn`
   * with it. Every connection in that client's pool issues `USE keyspace` on
   * handshake, so subsequent unqualified statements (`CREATE TABLE foo (...)`,
   * `INSERT INTO foo ...`, etc.) resolve correctly regardless of native
   * protocol version. This is what migration apply uses — the per-query
   * `keyspace` execute option only works on protocol v5+ (Cassandra 4.0+),
   * which we cannot assume.
   */
  async runWithKeyspace<T>(
    profileId: string,
    keyspace: string,
    fn: (client: cassandra.Client) => Promise<T>,
  ): Promise<T> {
    const existing = this.requireConnection(profileId);
    const profile = existing.profile;
    if (profile.type !== "cassandra") {
      throw new Error(`runWithKeyspace called for non-Cassandra profile ${profile.id}.`);
    }
    const options: cassandra.ClientOptions = {
      contactPoints: profile.contactPoints,
      localDataCenter: profile.localDataCenter,
      protocolOptions: { port: profile.port },
      keyspace,
    };
    const driver = await getDriver();
    if (profile.username && profile.password) {
      options.authProvider = new driver.auth.PlainTextAuthProvider(
        profile.username,
        profile.password,
      );
    }
    if (profile.useTls) options.sslOptions = {};

    const client = new driver.Client(options);
    try {
      await client.connect();
      return await fn(client);
    } finally {
      try {
        await client.shutdown();
      } catch {
        // Shutdown errors are non-fatal for the migration result.
      }
    }
  }

  async dispose(): Promise<void> {
    await Promise.all(
      Array.from(this.connections.keys(), (profileId) =>
        this.disconnect(profileId),
      ),
    );
  }

  private async fetchSchema(client: cassandra.Client): Promise<KeyspaceNode[]> {
    const result = await client.execute(
      "SELECT keyspace_name, table_name FROM system_schema.tables",
      [],
      { prepare: true },
    );

    const byKeyspace = new Map<string, TableNode[]>();
    for (const row of result.rows as unknown as SystemTableRow[]) {
      if (systemKeyspaces.has(row.keyspace_name)) {
        continue;
      }

      const tables = byKeyspace.get(row.keyspace_name) ?? [];
      tables.push({ name: row.table_name });
      byKeyspace.set(row.keyspace_name, tables);
    }

    return Array.from(byKeyspace, ([name, tables]) => ({
      name,
      tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  private requireConnection(profileId: string): ActiveConnection {
    const existing = this.connections.get(profileId);
    if (!existing) {
      throw new Error("Connection is not active.");
    }

    return existing;
  }
}

function coerceForCassandra(raw: string, cqlType: string): unknown {
  const type = cqlType.toLowerCase().trim();
  if (raw === "") return null;
  if (
    type === "int" ||
    type === "smallint" ||
    type === "tinyint" ||
    type === "varint" ||
    type === "counter"
  ) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid integer value for ${cqlType}: ${raw}`);
    return parsed;
  }
  // From here on we touch the driver's type helpers. Safe to use driverSync()
  // because deleteRows/runQuery are only callable after a successful connect,
  // which loaded the driver module.
  const types = driverSync().types;
  if (type === "bigint") {
    return types.Long.fromString(raw);
  }
  if (type === "double" || type === "float" || type === "decimal") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value for ${cqlType}: ${raw}`);
    return parsed;
  }
  if (type === "boolean") {
    return raw === "true" || raw === "1";
  }
  if (type === "uuid" || type === "timeuuid") {
    return type === "timeuuid"
      ? types.TimeUuid.fromString(raw)
      : types.Uuid.fromString(raw);
  }
  if (type === "timestamp") {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp value: ${raw}`);
    return date;
  }
  if (type === "date") {
    return types.LocalDate.fromString(raw);
  }
  if (type === "time") {
    return types.LocalTime.fromString(raw);
  }
  if (type === "inet") {
    return types.InetAddress.fromString(raw);
  }
  if (type === "blob") {
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
    return Buffer.from(hex, "hex");
  }
  // text, varchar, ascii, and anything else — pass the string through; driver coerces by prepared meta
  return raw;
}

function normalizeColumnRow(row: SystemColumnRow): ColumnMetadata {
  return {
    name: row.column_name,
    type: row.type,
    kind: row.kind,
    position: row.position,
  };
}

function compareColumns(a: ColumnMetadata, b: ColumnMetadata): number {
  const weight: Record<ColumnMetadata["kind"], number> = {
    partition_key: 0,
    clustering: 1,
    static: 2,
    regular: 3,
  };

  const kindDelta = weight[a.kind] - weight[b.kind];
  if (kindDelta !== 0) {
    return kindDelta;
  }

  return (
    (a.position ?? Number.MAX_SAFE_INTEGER) -
      (b.position ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name)
  );
}
