export type ColumnKind = "partition_key" | "clustering" | "static" | "regular";

export interface TableIdentity {
  profileId: string;
  profileName: string;
  keyspace: string;
  table: string;
}

export interface ColumnMetadata {
  name: string;
  type: string;
  kind: ColumnKind;
  position: number | null;
}

export interface TableSchemaPayload {
  table: TableIdentity;
  columns: ColumnMetadata[];
  partitionKeys: string[];
  clusteringKeys: string[];
}

export interface PreviewRowsPayload {
  columns: string[];
  rows: Record<string, string>[];
  /** Per-page chunk size used for this fetch (also the next-page batch size). */
  limit: number;
  /** When present, more rows remain — pass back to getPreview to continue paging. */
  pageState?: string;
}

export type PreviewFilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte";

export interface PreviewFilter {
  column: string;
  op: PreviewFilterOp;
  /** Compared value. Optional so an op like a future "is null" needs no value. */
  value?: string;
}

export interface PreviewSort {
  column: string;
  dir: "asc" | "desc";
}

/**
 * Optional server-side query refinement for {@link PreviewRowsPayload} fetches.
 * Entirely additive — when absent the engines fall back to their existing
 * unfiltered preview behaviour (Cassandra `pageState`, Postgres `LIMIT/OFFSET`).
 *
 * `cursor` carries keyset-pagination state for the Postgres path: an opaque,
 * base64-encoded snapshot of the last row's sort-key values, used to build a
 * `WHERE (sortcols) > cursor` continuation instead of an O(n) `OFFSET`.
 */
export interface PreviewQuery {
  filters?: PreviewFilter[];
  sort?: PreviewSort[];
  cursor?: string;
}

export interface QueryResultPayload extends PreviewRowsPayload {
  cql: string;
}

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  status: "pending" | "applied" | "applied-modified" | "failed";
  appliedAt?: string;
  checksum: string;
  appliedChecksum?: string;
  failedReason?: string;
}

export interface MigrationHistoryEntry {
  version: string;
  filename: string;
  appliedAt: string;
  success: boolean;
  statementsExecuted?: number;
  totalStatements?: number;
  errorMessage?: string;
}

export interface MigrationListPayload {
  keyspace: string;
  folder: string;
  files: MigrationFile[];
  trackingTableReady: boolean;
  history: MigrationHistoryEntry[];
}

export interface MigrationFailedStatement {
  index: number;
  total: number;
  cql: string;
}

export interface MigrationApplyResult {
  version: string;
  filename: string;
  statementsExecuted: number;
  totalStatements: number;
  durationMs: number;
  schemaAgreementOk: boolean;
  error?: string;
  failedStatement?: MigrationFailedStatement;
}

export interface MigrationPreview {
  version: string;
  filename: string;
  statements: string[];
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type WebviewToExtensionMessage =
  | { type: "loadPreview" }
  | { type: "refreshSchema" }
  | { type: "selectTable"; table: TableIdentity };

export type ExtensionToWebviewMessage =
  | { type: "tableSchema"; payload: TableSchemaPayload }
  | { type: "previewRows"; payload: PreviewRowsPayload }
  | {
      type: "connectionStatus";
      payload: { status: ConnectionStatus; detail?: string };
    }
  | { type: "error"; payload: { message: string } };
