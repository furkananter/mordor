import { describe, expect, it } from "vitest";
import { MigrationTracker } from "../src/core/cassandra/migrations/MigrationTracker";
import {
  TrackingColumn,
  classifyColumns,
  resolveColumnMap
} from "../src/core/cassandra/migrations/TrackingSchema";
import { ApplyOutcome, MigrationEntry } from "../src/core/cassandra/migrations/types";

function col(name: string, type = "text", kind = "regular"): TrackingColumn {
  return { name, type, kind };
}

const NATIVE_COLUMNS: TrackingColumn[] = [
  col("version", "text", "partition_key"),
  col("filename"),
  col("checksum"),
  col("applied_at", "timestamp"),
  col("success", "boolean"),
  col("error_message")
];

type ExecCall = { cql: string; params: unknown[] };

/**
 * A cassandra-driver stand-in that records every execute() and returns canned
 * rows based on which table the query targets. `inspectTrackingTable` is gone;
 * the tracker now reads the tracking table and (for adopted tables) the history
 * sidecar, so the fake routes those two SELECTs to separate row sets.
 */
function makeClient(rows: { columns?: unknown[]; tracking?: unknown[]; history?: unknown[] } = {}) {
  const calls: ExecCall[] = [];
  const client = {
    execute: async (cql: string, params: unknown[] = []) => {
      calls.push({ cql, params });
      if (/system_schema\.columns/.test(cql)) return { rows: rows.columns ?? [] };
      if (/schema_migrations_log/.test(cql) && /^\s*SELECT/i.test(cql)) return { rows: rows.history ?? [] };
      if (/^\s*SELECT/i.test(cql) && /schema_migrations/.test(cql)) return { rows: rows.tracking ?? [] };
      return { rows: [] };
    }
  } as unknown as import("cassandra-driver").Client;
  return { client, calls };
}

const entry: MigrationEntry = {
  version: "5",
  name: "add things",
  filename: "V5__add_things.cql",
  checksum: "deadbeef",
  contents: "CREATE TABLE x (id int PRIMARY KEY);"
};
const okOutcome: ApplyOutcome = { success: true, executed: 1, total: 1 };

describe("classifyColumns", () => {
  it("reports 'absent' when the table does not exist", () => {
    expect(classifyColumns([]).kind).toBe("absent");
  });

  it("recognises Mordor's own table as native", () => {
    const adapter = classifyColumns(NATIVE_COLUMNS);
    expect(adapter).toMatchObject({ kind: "ready", mode: "native" });
    if (adapter.kind === "ready") expect(adapter.map.version).toBe("version");
  });

  it("adopts a Rails-style (version-only) table read/write", () => {
    const adapter = classifyColumns([col("version", "text", "partition_key")]);
    expect(adapter).toMatchObject({ kind: "ready", mode: "adopted", tool: "Rails / ActiveRecord" });
    if (adapter.kind === "ready") expect(adapter.map.version).toBe("version");
  });

  it("adopts golang-migrate read-only (its `dirty` flag is the tell)", () => {
    const adapter = classifyColumns([col("version", "bigint", "partition_key"), col("dirty", "boolean")]);
    expect(adapter).toMatchObject({ kind: "ready", mode: "adopted-readonly", tool: "golang-migrate" });
    if (adapter.kind === "ready") {
      expect(adapter.map.version).toBe("version");
      // `dirty` is mapped as an inverted success flag.
      expect(adapter.map.success).toBe("dirty");
      expect(adapter.map.successInverted).toBe(true);
    }
  });

  it("maps a Flyway-style table, preferring `version` over `installed_rank`", () => {
    const adapter = classifyColumns([
      col("installed_rank", "int", "partition_key"),
      col("version"),
      col("description"),
      col("script"),
      col("checksum", "int"),
      col("installed_on", "timestamp"),
      col("success", "boolean")
    ]);
    expect(adapter).toMatchObject({ kind: "ready", mode: "adopted", tool: "Flyway" });
    if (adapter.kind === "ready") {
      expect(adapter.map.version).toBe("version");
      expect(adapter.map.filename).toBe("script");
      expect(adapter.map.checksum).toBe("checksum");
      expect(adapter.map.appliedAt).toBe("installed_on");
      expect(adapter.map.success).toBe("success");
    }
  });

  it("falls back to a key column when there is no `version`", () => {
    const map = resolveColumnMap([col("installed_rank", "int", "partition_key"), col("script")]);
    expect(map?.version).toBe("installed_rank");
  });

  it("reports 'unusable' when no version/identifier column is present", () => {
    const adapter = classifyColumns([col("foo"), col("bar")]);
    expect(adapter.kind).toBe("unusable");
  });
});

describe("MigrationTracker.fetchApplied", () => {
  const tracker = new MigrationTracker();

  it("reads applied versions through the native map", async () => {
    const adapter = classifyColumns(NATIVE_COLUMNS);
    const { client } = makeClient({
      tracking: [{ version: "1", filename: "V1__a.cql", checksum: "abc", applied_at: new Date(), success: true, error_message: null }]
    });
    const applied = await tracker.fetchApplied(client, "app", adapter);
    expect(applied.get("1")?.checksum).toBe("abc");
  });

  it("matches zero-padded and numeric version forms", async () => {
    const adapter = classifyColumns([col("version", "text", "partition_key")]);
    const { client } = makeClient({ tracking: [{ version: "001" }] });
    const applied = await tracker.fetchApplied(client, "app", adapter);
    expect(applied.has("001")).toBe(true);
    expect(applied.has("1")).toBe(true);
  });

  it("leaves checksum null for tables without a checksum column", async () => {
    const adapter = classifyColumns([col("version", "text", "partition_key")]);
    const { client } = makeClient({ tracking: [{ version: "7" }] });
    const applied = await tracker.fetchApplied(client, "app", adapter);
    expect(applied.get("7")?.checksum).toBeNull();
    expect(applied.get("7")?.success).toBe(true);
  });

  it("folds Mordor's own history into a read-only adopted table", async () => {
    const adapter = classifyColumns([col("version", "bigint", "partition_key"), col("dirty", "boolean")]);
    const { client } = makeClient({
      tracking: [{ version: 3, dirty: false }],
      history: [
        { version: "4", filename: "V4__x.cql", applied_at: new Date(), success: true },
        { version: "9", filename: "V9__y.cql", applied_at: new Date(), success: false }
      ]
    });
    const applied = await tracker.fetchApplied(client, "app", adapter);
    expect(applied.has("3")).toBe(true); // golang-migrate's current version
    expect(applied.has("4")).toBe(true); // remembered from Mordor history
    expect(applied.has("9")).toBe(false); // failed history entries are not "applied"
  });
});

describe("MigrationTracker.recordResult", () => {
  const tracker = new MigrationTracker();

  const trackingInsert = (calls: ExecCall[]) =>
    calls.find((c) => /^\s*INSERT/i.test(c.cql) && c.cql.includes(".schema_migrations ("));
  const historyInsert = (calls: ExecCall[]) =>
    calls.find((c) => /^\s*INSERT/i.test(c.cql) && c.cql.includes(".schema_migrations_log ("));

  it("writes all native columns plus a history row", async () => {
    const adapter = classifyColumns(NATIVE_COLUMNS);
    const { client, calls } = makeClient();
    await tracker.recordResult(client, "app", entry, okOutcome, adapter);
    const insert = trackingInsert(calls);
    expect(insert?.cql).toContain('"version"');
    expect(insert?.cql).toContain('"checksum"');
    expect(insert?.cql).toContain('"error_message"');
    expect(historyInsert(calls)).toBeTruthy();
  });

  it("upserts only the mapped columns for an adopted table", async () => {
    const adapter = classifyColumns([col("version", "text", "partition_key")]);
    const { client, calls } = makeClient();
    await tracker.recordResult(client, "app", entry, okOutcome, adapter);
    const insert = trackingInsert(calls);
    expect(insert?.cql).toContain('"version"');
    expect(insert?.cql).not.toContain('"checksum"');
    expect(insert?.params).toEqual(["5"]);
    expect(historyInsert(calls)).toBeTruthy();
  });

  it("does not record a failure into an adopted table that can't represent it", async () => {
    // Rails-style (version only): a bare version row would read back as applied,
    // so a failed apply must skip the foreign write and stay pending.
    const adapter = classifyColumns([col("version", "text", "partition_key")]);
    const { client, calls } = makeClient();
    await tracker.recordResult(client, "app", entry, { success: false, error: "boom" }, adapter);
    expect(trackingInsert(calls)).toBeUndefined();
    expect(historyInsert(calls)).toBeTruthy();
  });

  it("records a failure into an adopted table that has a success column", async () => {
    const adapter = classifyColumns([
      col("version", "text", "partition_key"),
      col("success", "boolean")
    ]);
    const { client, calls } = makeClient();
    await tracker.recordResult(client, "app", entry, { success: false, error: "boom" }, adapter);
    const insert = trackingInsert(calls);
    expect(insert?.cql).toContain('"success"');
    expect(insert?.params).toEqual(["5", false]);
  });

  it("never writes the tracking table in read-only mode", async () => {
    const adapter = classifyColumns([col("version", "bigint", "partition_key"), col("dirty", "boolean")]);
    const { client, calls } = makeClient();
    await tracker.recordResult(client, "app", entry, okOutcome, adapter);
    expect(trackingInsert(calls)).toBeUndefined();
    expect(historyInsert(calls)).toBeTruthy();
  });
});

describe("MigrationTracker.ensureTrackingTable", () => {
  const tracker = new MigrationTracker();

  it("creates Mordor's table when none exists and returns a native adapter", async () => {
    const { client, calls } = makeClient({ columns: [] });
    const adapter = await tracker.ensureTrackingTable(client, "app");
    expect(adapter).toMatchObject({ kind: "ready", mode: "native" });
    expect(calls.some((c) => /CREATE TABLE IF NOT EXISTS .*schema_migrations /.test(c.cql))).toBe(true);
  });

  it("throws a guided error for an unusable foreign table", async () => {
    const { client } = makeClient({ columns: [{ column_name: "foo", type: "text", kind: "regular" }] });
    await expect(tracker.ensureTrackingTable(client, "app")).rejects.toThrow(/track migrations by/i);
  });
});
