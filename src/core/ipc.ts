import { ConnectionDraft, ConnectionProfile } from "./config/profile";
import { KeyspaceNode } from "./cassandra/CassandraService";
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

export type ProfileListItem = ConnectionProfile & {
  connected: boolean;
  schema: KeyspaceNode[];
};

export type CassandraProfileListItem = Extract<ProfileListItem, { type: "cassandra" }>;
export type RedisProfileListItem = Extract<ProfileListItem, { type: "redis" }>;

export interface ConnectResult {
  profileId: string;
  schema: KeyspaceNode[];
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
  statements: SchemaScriptStatementResult[];
  error?: string;
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
  refreshSchema(profileId: string): Promise<KeyspaceNode[]>;
  getTableSchema(table: TableIdentity): Promise<TableSchemaPayload>;
  getPreview(table: TableIdentity, pageState?: string): Promise<PreviewRowsPayload>;
  runSelectQuery(profileId: string, cql: string, mode?: "read" | "write" | "all"): Promise<QueryResultPayload>;
  deleteTableRows(table: TableIdentity, rows: Array<Record<string, string>>): Promise<{ deleted: number }>;
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
} as const;
