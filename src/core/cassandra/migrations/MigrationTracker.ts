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

export class MigrationTracker {
  async hasTrackingTable(client: cassandra.Client, keyspace: string): Promise<boolean> {
    const result = await client.execute(
      "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?",
      [keyspace, TRACKING_TABLE],
      { prepare: true }
    );
    return result.rows.length > 0;
  }

  async ensureTrackingTable(client: cassandra.Client, keyspace: string): Promise<void> {
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
