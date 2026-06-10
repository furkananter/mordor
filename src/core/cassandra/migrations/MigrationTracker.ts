import type * as cassandra from "cassandra-driver";
import { MigrationHistoryEntry } from "../../shared/messages";
import {
  AppliedRow,
  ApplyOutcome,
  HISTORY_LIMIT,
  HISTORY_TABLE,
  MigrationEntry,
  REQUIRED_TRACKING_COLUMNS,
  TRACKING_TABLE,
  quoteIdent,
  versionKeyVariants,
  versionToString
} from "./types";
import {
  TrackingAdapter,
  buildTrackingInsert,
  classifyColumns,
  isWritable,
  nativeMap,
  rowToApplied,
  uniqueColumns,
  unusableTrackingError
} from "./TrackingSchema";

export class MigrationTracker {
  /**
   * Inspect the keyspace's `schema_migrations` table and decide how Mordor can
   * work with it. A `schema_migrations` table is an extremely common name —
   * golang-migrate, Flyway, Liquibase, Rails and others all reach for it, each
   * with their own column layout. Rather than failing on a foreign one, we map
   * its columns and adapt (read-only for golang-migrate's single-row design).
   */
  async resolveTracking(client: cassandra.Client, keyspace: string): Promise<TrackingAdapter> {
    const result = await client.execute(
      "SELECT column_name, type, kind FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
      [keyspace, TRACKING_TABLE],
      { prepare: true }
    );
    return classifyColumns(
      result.rows.map((row) => ({
        name: String(row["column_name"]),
        type: String(row["type"] ?? ""),
        kind: String(row["kind"] ?? "")
      }))
    );
  }

  /**
   * Ensure there is a usable tracking table and return the adapter for it.
   * Creates Mordor's own table only when none exists; an adopted foreign table
   * is left exactly as-is. The Mordor-owned history table is always ensured.
   */
  async ensureTrackingTable(client: cassandra.Client, keyspace: string): Promise<TrackingAdapter> {
    let adapter = await this.resolveTracking(client, keyspace);
    if (adapter.kind === "unusable") {
      throw unusableTrackingError(keyspace, adapter.columns);
    }
    if (adapter.kind === "absent") {
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
      adapter = { kind: "ready", mode: "native", map: nativeMap(), columns: [...REQUIRED_TRACKING_COLUMNS] };
    }
    await this.ensureHistoryTable(client, keyspace);
    return adapter;
  }

  private async ensureHistoryTable(client: cassandra.Client, keyspace: string): Promise<void> {
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

  /**
   * Which migration versions are already applied. Reads the tracking table
   * through the adapter's column map, then — for adopted tables — folds in
   * Mordor's own history so applies it made are remembered even when the table
   * is read-only (golang-migrate) or a foreign write was skipped.
   */
  async fetchApplied(
    client: cassandra.Client,
    keyspace: string,
    adapter: TrackingAdapter
  ): Promise<Map<string, AppliedRow>> {
    const map = new Map<string, AppliedRow>();
    if (adapter.kind !== "ready") return map;
    const columnMap = adapter.map;

    try {
      const columns = uniqueColumns(columnMap).map(quoteIdent).join(", ");
      const result = await client.execute(
        `SELECT ${columns} FROM ${quoteIdent(keyspace)}.${TRACKING_TABLE}`
      );
      for (const row of result.rows as unknown as Record<string, unknown>[]) {
        const version = versionToString(row[columnMap.version]);
        if (!version) continue;
        const applied = rowToApplied(version, row, columnMap);
        for (const key of versionKeyVariants(version)) {
          if (!map.has(key)) map.set(key, applied);
        }
      }
    } catch {
      // A foreign table can have a shape our SELECT trips over; fall back to the
      // history sidecar below rather than failing the whole listing.
    }

    if (adapter.mode !== "native") {
      await this.mergeHistoryApplied(client, keyspace, map);
    }
    return map;
  }

  private async mergeHistoryApplied(
    client: cassandra.Client,
    keyspace: string,
    map: Map<string, AppliedRow>
  ): Promise<void> {
    const history = await this.fetchHistory(client, keyspace);
    for (const entry of history) {
      if (!entry.success) continue;
      const variants = versionKeyVariants(entry.version);
      if (variants.some((key) => map.has(key))) continue;
      const applied: AppliedRow = {
        version: entry.version,
        filename: entry.filename,
        checksum: null,
        applied_at: entry.appliedAt || null,
        success: true,
        error_message: null
      };
      for (const key of variants) {
        if (!map.has(key)) map.set(key, applied);
      }
    }
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

  /**
   * Record the result of an apply. Native tables are written directly; adopted
   * tables get a best-effort upsert that never blocks the apply (the schema
   * change already ran, and the history sidecar is the safety net); read-only
   * tables are left untouched. History is always recorded, non-fatally.
   */
  async recordResult(
    client: cassandra.Client,
    keyspace: string,
    entry: MigrationEntry,
    outcome: ApplyOutcome,
    adapter: TrackingAdapter
  ): Promise<void> {
    const now = new Date();
    if (adapter.kind === "ready" && isWritable(adapter.mode)) {
      if (adapter.mode === "native") {
        const insert = buildTrackingInsert(keyspace, adapter.map, entry, outcome, now);
        await client.execute(insert.cql, insert.params, { prepare: true });
      } else if (outcome.success || adapter.map.success) {
        // Adopt-write only when we can represent the result faithfully. A failed
        // apply must not be written to a table with no success/failure column,
        // since a bare version row would read back as "applied" — leave it
        // pending (retryable) and let history record the failure instead.
        // Best-effort otherwise: a foreign table's quirks (odd column names,
        // type mismatches) must never fail the apply — the schema change already
        // ran and the history sidecar below is the safety net.
        try {
          const insert = buildTrackingInsert(keyspace, adapter.map, entry, outcome, now);
          await client.execute(insert.cql, insert.params, { prepare: true });
        } catch (caught) {
          console.warn(`Mordor could not update the adopted ${TRACKING_TABLE} table:`, caught);
        }
      }
    }
    await this.recordHistory(client, keyspace, entry, outcome, now);
  }

  private async recordHistory(
    client: cassandra.Client,
    keyspace: string,
    entry: MigrationEntry,
    outcome: ApplyOutcome,
    now: Date
  ): Promise<void> {
    try {
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
    } catch (caught) {
      console.warn("Mordor could not write migration history:", caught);
    }
  }
}
