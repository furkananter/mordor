import {
  CassandraProfile,
  ConnectionDraft,
  PostgresProfile,
  RedisProfile
} from "./config/profile";
import { AdapterSchema } from "./db/types";
import {
  MigrationApplyResult,
  MigrationListPayload,
  MigrationPreview,
  PreviewRowsPayload,
  QueryResultPayload,
  TableIdentity,
  TableSchemaPayload,
} from "./shared/messages";
import { LocalDiscoveryResult } from "./cassandra/localDiscovery";

export type CreateProfileInput = ConnectionDraft;

// Per-DB list items pair the profile fields with the matching schema variant.
// Built explicitly (instead of `ConnectionProfile & { schema: AdapterSchema }`)
// so `Extract<ProfileListItem, { type: "cassandra" }>` carries the cassandra
// schema variant too — narrowing on `profile.type` narrows `profile.schema`
// in one step instead of forcing a second `kind` check at every callsite.
export type CassandraProfileListItem = CassandraProfile & {
  connected: boolean;
  schema: Extract<AdapterSchema, { kind: "cassandra" }>;
};

export type RedisProfileListItem = RedisProfile & {
  connected: boolean;
  schema: Extract<AdapterSchema, { kind: "redis" }>;
};

export type PostgresProfileListItem = PostgresProfile & {
  connected: boolean;
  schema: Extract<AdapterSchema, { kind: "postgres" }>;
};

export type ProfileListItem =
  | CassandraProfileListItem
  | RedisProfileListItem
  | PostgresProfileListItem;

export interface ConnectResult {
  profileId: string;
  schema: AdapterSchema;
}

export interface RedisKeyEntry {
  key: string;
  type: "string" | "list" | "set" | "zset" | "hash" | "stream" | "none";
  ttl: number;
}

export interface RedisKeyValue {
  key: string;
  type: RedisKeyEntry["type"];
  ttl: number;
  value:
    | { kind: "string"; data: string }
    | { kind: "list"; data: string[] }
    | { kind: "set"; data: string[] }
    | { kind: "zset"; data: Array<{ member: string; score: number }> }
    | { kind: "hash"; data: Array<{ field: string; value: string }> }
    | { kind: "stream"; data: Array<{ id: string; fields: Array<{ field: string; value: string }> }> }
    | { kind: "none" };
}

export interface RedisScanResult {
  cursor: string;
  keys: RedisKeyEntry[];
}

export interface RedisCommandResult {
  ok: boolean;
  result?: string;
  error?: string;
}

export interface RedisDbStat {
  index: number;
  keys: number;
}

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
  /**
   * Postgres-only: the script was wrapped in a transaction and rolled back
   * because at least one statement failed. Cassandra leaves this undefined
   * (its DDL is non-transactional — earlier successes persist regardless).
   * The renderer uses this to label per-statement ✓ marks as "attempted
   * (rolled back)" so users don't think the early statements landed.
   */
  rolledBack?: boolean;
  statements: SchemaScriptStatementResult[];
  error?: string;
}

/**
 * Auto-updater lifecycle states pushed from the main process to the renderer.
 *
 *   - idle          → no check has run yet (boot before scheduled check, dev mode)
 *   - checking      → talking to the release server
 *   - available     → newer version exists, download starting/in flight
 *   - downloading   → progress reported with bytes + percent
 *   - downloaded    → bits on disk, waiting for the user to confirm install
 *   - not-available → server reachable, current version is latest
 *   - error         → check or download failed; `error` carries the message
 *   - unsupported   → reserved for platforms with no update path at all
 *
 * On Linux/Windows electron-updater drives the whole lifecycle and the
 * `downloaded` state means "restart to install". On macOS the ad-hoc-signed
 * build can't be applied by Squirrel, so the main process downloads the
 * matching DMG itself (still surfacing `downloading`/`downloaded`) and the
 * `downloaded` state instead carries `installerPath` — the renderer offers
 * "Open installer" to mount it for a drag-to-Applications install. The mac
 * statuses also keep `releasesUrl` so a manual GitHub download stays one
 * click away if the assisted flow ever fails.
 */
export type UpdateStatusKind =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error"
  | "unsupported";

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateStatus {
  kind: UpdateStatusKind;
  version?: string;
  progress?: UpdateProgress;
  error?: string;
  lastCheckedAt?: number;
  releasesUrl?: string;
  /**
   * macOS only: absolute path to the downloaded `.dmg` once `kind` is
   * `downloaded`. Its presence is what tells the renderer to render "Open
   * installer" (mount the DMG) instead of the Linux/Windows "Restart to
   * install" (Squirrel `quitAndInstall`).
   */
  installerPath?: string;
}

export interface CassandraDeskApi {
  listProfiles(): Promise<ProfileListItem[]>;
  createProfile(input: CreateProfileInput): Promise<ProfileListItem[]>;
  updateProfile(profileId: string, input: CreateProfileInput): Promise<ProfileListItem[]>;
  deleteProfile(profileId: string): Promise<ProfileListItem[]>;
  detectLocalConnections(): Promise<{
    detected: LocalDiscoveryResult[];
    profiles: ProfileListItem[];
    logs: string[];
  }>;
  connect(profileId: string): Promise<ConnectResult>;
  disconnect(profileId: string): Promise<ProfileListItem[]>;
  refreshSchema(profileId: string): Promise<AdapterSchema>;
  getTableSchema(table: TableIdentity): Promise<TableSchemaPayload>;
  getPreview(table: TableIdentity, pageState?: string): Promise<PreviewRowsPayload>;
  runSelectQuery(profileId: string, cql: string, mode?: "read" | "write" | "all"): Promise<QueryResultPayload>;
  deleteTableRows(table: TableIdentity, rows: Array<Record<string, string>>): Promise<{ deleted: number }>;
  insertTableRow(table: TableIdentity, values: Record<string, string>): Promise<{ inserted: number }>;
  getTableDdl(table: TableIdentity): Promise<string>;
  runSchemaScript(profileId: string, cql: string): Promise<SchemaScriptResult>;
  pickMigrationsFolder(): Promise<string | undefined>;
  listMigrations(profileId: string, keyspace: string, folder: string): Promise<MigrationListPayload>;
  previewMigration(folder: string, version: string): Promise<MigrationPreview>;
  createMigration(folder: string, name: string): Promise<{ filename: string; version: string }>;
  readMigrationFile(folder: string, filename: string): Promise<string>;
  writeMigrationFile(folder: string, filename: string, contents: string): Promise<void>;
  applyMigration(profileId: string, keyspace: string, folder: string, version: string): Promise<MigrationApplyResult>;
  ensureMigrationTable(profileId: string, keyspace: string): Promise<void>;
  redisDbStats(profileId: string): Promise<RedisDbStat[]>;
  redisScan(profileId: string, db: number, pattern: string, cursor: string): Promise<RedisScanResult>;
  redisGet(profileId: string, db: number, key: string): Promise<RedisKeyValue>;
  redisDelete(profileId: string, db: number, key: string): Promise<void>;
  redisSetString(profileId: string, db: number, key: string, value: string, ttlSeconds?: number): Promise<void>;
  redisCommand(profileId: string, db: number, command: string): Promise<RedisCommandResult>;
  setZoomFactor(factor: number): void;
  onFullscreenChange(callback: (fullscreen: boolean) => void): () => void;
  terminalCreate(options: { cwd?: string; cols?: number; rows?: number }): Promise<string>;
  terminalWrite(id: string, data: string): void;
  terminalResize(id: string, cols: number, rows: number): void;
  terminalKill(id: string): void;
  onTerminalData(callback: (id: string, data: string) => void): () => void;
  onTerminalExit(callback: (id: string, info: { exitCode: number; signal?: number }) => void): () => void;
  /** Snapshot of the most recent update status. Safe to call any time. */
  getUpdateStatus(): Promise<UpdateStatus>;
  /** Manually trigger a check. No-op when the platform is `unsupported` or in dev. */
  checkForUpdates(): Promise<void>;
  /** Quit + relaunch into the downloaded update. Caller should confirm first. */
  installUpdate(): Promise<void>;
  /**
   * Subscribe to status pushes. Returns an unsubscribe. The current snapshot
   * is broadcast on subscription so callers don't have to chain
   * `getUpdateStatus()` themselves to seed initial state.
   */
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
}

export const ipcChannels = {
  listProfiles: "profiles:list",
  createProfile: "profiles:create",
  updateProfile: "profiles:update",
  deleteProfile: "profiles:delete",
  detectLocalConnections: "connections:detect-local",
  connect: "connections:connect",
  disconnect: "connections:disconnect",
  refreshSchema: "schema:refresh",
  getTableSchema: "table:get-schema",
  getPreview: "table:get-preview",
  runSelectQuery: "query:run-select",
  deleteTableRows: "table:delete-rows",
  insertTableRow: "table:insert-row",
  getTableDdl: "table:get-ddl",
  runSchemaScript: "schema:run-script",
  pickMigrationsFolder: "migrations:pick-folder",
  listMigrations: "migrations:list",
  previewMigration: "migrations:preview",
  createMigration: "migrations:create",
  readMigrationFile: "migrations:read-file",
  writeMigrationFile: "migrations:write-file",
  applyMigration: "migrations:apply",
  ensureMigrationTable: "migrations:ensure-table",
  redisDbStats: "redis:db-stats",
  redisScan: "redis:scan",
  redisGet: "redis:get",
  redisDelete: "redis:delete",
  redisSetString: "redis:set-string",
  redisCommand: "redis:command",
  terminalCreate: "terminal:create",
  terminalWrite: "terminal:write",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  getUpdateStatus: "updater:get-status",
  checkForUpdates: "updater:check",
  installUpdate: "updater:install",
} as const;
