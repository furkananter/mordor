import type * as cassandra from "cassandra-driver";
import { MigrationHistoryEntry } from "../../shared/messages";
import {
  AppliedRow,
  HISTORY_LIMIT,
  HISTORY_TABLE,
  MigrationEntry,
  TRACKING_TABLE,
  quoteIdent
} from "./types";

interface ApplyOutcome {
  success: boolean;
  error?: string;
  executed?: number;
  total?: number;
}

/** Columns Mordor reads from / writes to the tracking table. */
const REQUIRED_TRACKING_COLUMNS = [
  "version",
  "filename",
  "checksum",
  "applied_at",
  "success",
  "error_message"
] as const;

export type TrackingTableStatus = "absent" | "compatible" | "incompatible";

export class MigrationTracker {
  async hasTrackingTable(client: cassandra.Client, keyspace: string): Promise<boolean> {
    const result = await client.execute(
      "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?",
      [keyspace, TRACKING_TABLE],
      { prepare: true }
    );
    return result.rows.length > 0;
  }

  /**
   * A `schema_migrations` table is an extremely common name — golang-migrate,
   * Flyway, Liquibase, Rails, and others all reach for it, each with their own
   * column layout. If one of those already lives in the target keyspace, our
   * `CREATE TABLE IF NOT EXISTS` silently no-ops and every subsequent
   * `SELECT version, …` blows up with a cryptic "Undefined column name version".
   * Inspecting the actual columns lets us tell "ours" from "someone else's" and
   * surface an actionable error instead.
   */
  async inspectTrackingTable(
    client: cassandra.Client,
    keyspace: string
  ): Promise<TrackingTableStatus> {
    const result = await client.execute(
      "SELECT column_name FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
      [keyspace, TRACKING_TABLE],
      { prepare: true }
    );
    if (result.rows.length === 0) return "absent";
    const columns = new Set(result.rows.map((row) => String(row["column_name"])));
    const compatible = REQUIRED_TRACKING_COLUMNS.every((column) => columns.has(column));
    return compatible ? "compatible" : "incompatible";
  }

  /** Throws a guided error when a foreign `schema_migrations` table is in the way. */
  async assertTrackingTableUsable(client: cassandra.Client, keyspace: string): Promise<void> {
    const status = await this.inspectTrackingTable(client, keyspace);
    if (status === "incompatible") {
      throw new Error(
        `A "${TRACKING_TABLE}" table already exists in keyspace "${keyspace}", but it was ` +
          `created by another migration tool — it is missing columns Mordor needs ` +
          `(${REQUIRED_TRACKING_COLUMNS.join(", ")}). Drop or rename that table, or point ` +
          `this connection at a keyspace that doesn't already use "${TRACKING_TABLE}", then reload.`
      );
    }
  }

  async ensureTrackingTable(client: cassandra.Client, keyspace: string): Promise<void> {
    await this.assertTrackingTableUsable(client, keyspace);
    await client.execute(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(keyspace)}.${TRACKING_TABLE} (
        version text PRIMARY KEY,
        filename text,
        checksum text,
        applied_at timestamp,
        success boolean,
        error_message text
      )`
    );
    await client.execute(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(keyspace)}.${HISTORY_TABLE} (
        bucket text,
        applied_at timestamp,
        version text,
        filename text,
        success boolean,
        statements_executed int,
        total_statements int,
        error_message text,
        PRIMARY KEY (bucket, applied_at)
      ) WITH CLUSTERING ORDER BY (applied_at DESC)`
    );
  }

  async fetchApplied(client: cassandra.Client, keyspace: string): Promise<Map<string, AppliedRow>> {
    const result = await client.execute(
      `SELECT version, filename, checksum, applied_at, success, error_message FROM ${quoteIdent(keyspace)}.${TRACKING_TABLE}`
    );
    const map = new Map<string, AppliedRow>();
    for (const row of result.rows as unknown as AppliedRow[]) {
      map.set(row.version, row);
    }
    return map;
  }

  async fetchHistory(client: cassandra.Client, keyspace: string): Promise<MigrationHistoryEntry[]> {
    try {
      const result = await client.execute(
        `SELECT version, filename, applied_at, success, statements_executed, total_statements, error_message FROM ${quoteIdent(keyspace)}.${HISTORY_TABLE} WHERE bucket = ? LIMIT ${HISTORY_LIMIT}`,
        ["log"],
        { prepare: true }
      );
      return result.rows.map((row) => {
        const appliedAt = row["applied_at"];
        const entry: MigrationHistoryEntry = {
          version: String(row["version"] ?? ""),
          filename: String(row["filename"] ?? ""),
          appliedAt: appliedAt instanceof Date ? appliedAt.toISOString() : String(appliedAt ?? ""),
          success: Boolean(row["success"])
        };
        if (row["statements_executed"] != null) entry.statementsExecuted = Number(row["statements_executed"]);
        if (row["total_statements"] != null) entry.totalStatements = Number(row["total_statements"]);
        if (row["error_message"]) entry.errorMessage = String(row["error_message"]);
        return entry;
      });
    } catch {
      return [];
    }
  }

  async recordResult(
    client: cassandra.Client,
    keyspace: string,
    entry: MigrationEntry,
    outcome: ApplyOutcome
  ): Promise<void> {
    const now = new Date();
    await client.execute(
      `INSERT INTO ${quoteIdent(keyspace)}.${TRACKING_TABLE} (version, filename, checksum, applied_at, success, error_message) VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.version, entry.filename, entry.checksum, now, outcome.success, outcome.error ?? null],
      { prepare: true }
    );
    await client.execute(
      `INSERT INTO ${quoteIdent(keyspace)}.${HISTORY_TABLE} (bucket, applied_at, version, filename, success, statements_executed, total_statements, error_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "log",
        now,
        entry.version,
        entry.filename,
        outcome.success,
        outcome.executed ?? null,
        outcome.total ?? null,
        outcome.error ?? null
      ],
      { prepare: true }
    );
  }
}
