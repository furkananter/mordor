import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresService } from "../src/core/postgres/PostgresService";
import type { TableIdentity } from "../src/core/shared/messages";

// deleteRows is exercised end-to-end against a fake pg.Client. The real
// service reaches the database through `fetchTableSchema` (two catalog
// queries — columns + primary key) and then a per-row DELETE wrapped in
// BEGIN/COMMIT. We stub `client.query` and route by SQL text so the test
// stays deterministic and never touches a real Postgres.

interface FakeQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface FakeClientOptions {
  // Primary-key columns the faked `fetchTableSchema` should report. An empty
  // array models a table with no primary key.
  primaryKeys: string[];
  // rowCount each DELETE reports. Defaults to 1 per statement.
  deleteRowCount?: number;
  // When set, the Nth (1-based) DELETE rejects to model a mid-loop failure.
  failOnDeleteCall?: number;
}

function makeService(options: FakeClientOptions): {
  service: PostgresService;
  query: ReturnType<typeof vi.fn>;
  log: string[];
} {
  const log: string[] = [];
  let deleteCalls = 0;

  const query = vi.fn(
    async (sql: string, _params?: unknown[]): Promise<FakeQueryResult> => {
      log.push(sql);
      // fetchTableSchema's first round-trip: information_schema.columns.
      if (sql.includes("information_schema.columns")) {
        const columns = [...options.primaryKeys, "name"].map((name, index) => ({
          column_name: name,
          data_type: "text",
          udt_name: "text",
          ordinal_position: index + 1,
          is_nullable: "YES" as const,
        }));
        return { rows: columns, rowCount: columns.length };
      }
      // fetchTableSchema's second round-trip: pg_index primary-key lookup.
      if (sql.includes("pg_index")) {
        const rows = options.primaryKeys.map((attname, index) => ({
          attname,
          pos: index,
        }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("DELETE")) {
        deleteCalls += 1;
        if (options.failOnDeleteCall && deleteCalls === options.failOnDeleteCall) {
          throw new Error("delete blew up");
        }
        return { rows: [], rowCount: options.deleteRowCount ?? 1 };
      }
      // BEGIN / COMMIT / ROLLBACK.
      return { rows: [], rowCount: null };
    },
  );

  const service = new PostgresService();
  // Seed the private connection map directly — the service reaches the fake
  // client through `requireConnection`, so no real `connect()` is needed.
  (service as unknown as { connections: Map<string, unknown> }).connections.set(
    "profile-1",
    { profile: { name: "p" }, client: { query }, schemas: [] },
  );

  return { service, query, log };
}

const table: TableIdentity = {
  profileId: "profile-1",
  profileName: "p",
  keyspace: "public",
  table: "widgets",
};

describe("PostgresService.deleteRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the table has no primary key", async () => {
    const { service } = makeService({ primaryKeys: [] });
    await expect(
      service.deleteRows(table, [{ id: "1" }]),
    ).rejects.toThrow(/no primary key/i);
  });

  it("throws listing 1-based row indices when a key value is empty or whitespace", async () => {
    const { service } = makeService({ primaryKeys: ["id"] });
    await expect(
      service.deleteRows(table, [
        { id: "1" }, // ok
        { id: "" }, // empty -> row 2
        { id: "5" }, // ok
        { id: "   " }, // whitespace -> row 4
      ]),
    ).rejects.toThrow(/rows: 2, 4/);
  });

  it("builds a parameterized DELETE with quoted identifiers and $1..$n placeholders", async () => {
    const { service, query } = makeService({ primaryKeys: ["org_id", "id"] });
    await service.deleteRows(table, [{ org_id: "7", id: "42" }]);

    const deleteCall = query.mock.calls.find(([sql]) =>
      String(sql).startsWith("DELETE"),
    );
    expect(deleteCall).toBeDefined();
    const [sql, params] = deleteCall!;
    expect(sql).toBe(
      'DELETE FROM "public"."widgets" WHERE "org_id" = $1 AND "id" = $2',
    );
    // Params are bound positionally in primary-key order, never interpolated.
    expect(params).toEqual(["7", "42"]);
  });

  it("runs BEGIN before and COMMIT after the per-row deletes", async () => {
    const { service, log } = makeService({ primaryKeys: ["id"] });
    await service.deleteRows(table, [{ id: "1" }, { id: "2" }]);

    const txOrder = log
      .filter(
        (sql) =>
          sql === "BEGIN" || sql === "COMMIT" || sql.startsWith("DELETE"),
      )
      .map((sql) => (sql.startsWith("DELETE") ? "DELETE" : sql));
    expect(txOrder).toEqual(["BEGIN", "DELETE", "DELETE", "COMMIT"]);
  });

  it("ROLLBACKs and rethrows on a mid-loop failure", async () => {
    const { service, log } = makeService({
      primaryKeys: ["id"],
      failOnDeleteCall: 2,
    });
    await expect(
      service.deleteRows(table, [{ id: "1" }, { id: "2" }, { id: "3" }]),
    ).rejects.toThrow("delete blew up");

    // First delete succeeded, second threw — we must ROLLBACK and never COMMIT,
    // and must not attempt the third delete.
    expect(log).toContain("ROLLBACK");
    expect(log).not.toContain("COMMIT");
    expect(log.filter((sql) => sql.startsWith("DELETE"))).toHaveLength(2);
  });

  it("returns the summed rowCount across every per-row delete", async () => {
    const { service } = makeService({ primaryKeys: ["id"], deleteRowCount: 1 });
    const result = await service.deleteRows(table, [
      { id: "1" },
      { id: "2" },
      { id: "3" },
    ]);
    expect(result).toEqual({ deleted: 3 });
  });

  it("short-circuits to zero deletions for an empty selection", async () => {
    const { service, query } = makeService({ primaryKeys: ["id"] });
    const result = await service.deleteRows(table, []);
    expect(result).toEqual({ deleted: 0 });
    // No connection lookup or query when there is nothing to delete.
    expect(query).not.toHaveBeenCalled();
  });
});
