import { describe, expect, it } from "vitest";
import {
  CassandraExportKeyspace,
  CassandraExportTable,
  cqlLiteral,
  renderCreateKeyspace,
  renderCreateTable,
  renderInsert,
  renderSchemaScript,
} from "../src/core/cassandra/exportRenderer";

const KEYSPACE: CassandraExportKeyspace = {
  name: "app",
  replication: { class: "SimpleStrategy", replication_factor: "3" },
  durableWrites: true,
  tables: [],
};

const ORDERS_TABLE: CassandraExportTable = {
  keyspace: "app",
  name: "orders",
  columns: [
    { name: "user_id", type: "uuid", kind: "partition_key", position: 0 },
    { name: "order_id", type: "timeuuid", kind: "partition_key", position: 1 },
    { name: "created", type: "timestamp", kind: "clustering", position: 0, clusteringOrder: "desc" },
    { name: "total", type: "decimal", kind: "regular", position: null },
    { name: "tags", type: "set<text>", kind: "regular", position: null },
    { name: "country", type: "text", kind: "static", position: null },
  ],
};

describe("cqlLiteral", () => {
  it("renders primitives", () => {
    expect(cqlLiteral(null, "text")).toBe("null");
    expect(cqlLiteral(undefined, "text")).toBe("null");
    expect(cqlLiteral(true, "boolean")).toBe("true");
    expect(cqlLiteral(false, "boolean")).toBe("false");
    expect(cqlLiteral(42, "int")).toBe("42");
    expect(cqlLiteral(BigInt("9223372036854775807"), "bigint")).toBe("9223372036854775807");
  });
  it("quotes strings", () => {
    expect(cqlLiteral("hello", "text")).toBe("'hello'");
    expect(cqlLiteral("it's fine", "text")).toBe("'it''s fine'");
  });
  it("renders Date as ISO timestamp string", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(cqlLiteral(date, "timestamp")).toBe("'2026-01-01T00:00:00.000Z'");
  });
  it("renders Buffer as 0x hex blob", () => {
    expect(cqlLiteral(Buffer.from([0xde, 0xad]), "blob")).toBe("0xdead");
  });
  it("renders arrays as list<T> with bracket syntax", () => {
    expect(cqlLiteral(["a", "b"], "list<text>")).toBe(`['a', 'b']`);
  });
  it("renders Set as set<T> with brace syntax", () => {
    expect(cqlLiteral(new Set(["x", "y"]), "set<text>")).toBe(`{'x', 'y'}`);
  });
  it("renders Map as map<K,V> with key:value syntax", () => {
    const m = new Map([["k1", "v1"]]);
    expect(cqlLiteral(m, "map<text,text>")).toBe(`{'k1': 'v1'}`);
  });
  it("emits bare uuid/timeuuid (no quotes)", () => {
    // Simulate a driver Uuid wrapper — non-plain object with toString
    const fakeUuid = {
      toString: () => "11111111-1111-1111-1111-111111111111",
    };
    expect(cqlLiteral(fakeUuid, "uuid")).toBe("11111111-1111-1111-1111-111111111111");
    expect(cqlLiteral(fakeUuid, "timeuuid")).toBe("11111111-1111-1111-1111-111111111111");
  });
});

describe("renderCreateKeyspace", () => {
  it("emits the replication map with quoted keys + numeric RF unquoted", () => {
    const cql = renderCreateKeyspace(KEYSPACE);
    expect(cql).toContain(`CREATE KEYSPACE IF NOT EXISTS "app"`);
    expect(cql).toContain(`'class': 'SimpleStrategy'`);
    expect(cql).toContain(`'replication_factor': 3`); // numeric → unquoted
    expect(cql.endsWith(";")).toBe(true);
  });
  it("appends durable_writes when false", () => {
    expect(renderCreateKeyspace({ ...KEYSPACE, durableWrites: false })).toContain(
      "durable_writes = false",
    );
  });
});

describe("renderCreateTable", () => {
  it("builds compound primary key with partition tuple + clustering cols", () => {
    const cql = renderCreateTable(ORDERS_TABLE);
    expect(cql).toContain(`CREATE TABLE IF NOT EXISTS "app"."orders"`);
    expect(cql).toContain(`PRIMARY KEY (("user_id", "order_id"), "created")`);
    expect(cql).toContain(`"country" text STATIC`);
    expect(cql).toContain(`WITH CLUSTERING ORDER BY ("created" DESC)`);
  });
});

describe("renderInsert", () => {
  it("emits an INSERT with present columns only", () => {
    const cql = renderInsert(ORDERS_TABLE, {
      user_id: { toString: () => "u-1" },
      order_id: { toString: () => "o-1" },
      created: new Date(Date.UTC(2026, 0, 1)),
      total: 12.5,
      country: "TR",
      // tags omitted → not in INSERT
    });
    expect(cql).toContain(`INSERT INTO "app"."orders"`);
    expect(cql).toContain(`("user_id", "order_id", "created", "total", "country")`);
    expect(cql).not.toContain(`"tags"`);
  });
  it("returns empty string for tombstone rows (all columns undefined)", () => {
    expect(renderInsert(ORDERS_TABLE, {})).toBe("");
  });
});

describe("renderSchemaScript", () => {
  it("groups CREATE TABLE statements under their keyspace", () => {
    const script = renderSchemaScript([
      { ...KEYSPACE, tables: [ORDERS_TABLE] },
    ]);
    const ksIdx = script.indexOf(`CREATE KEYSPACE IF NOT EXISTS "app"`);
    const tableIdx = script.indexOf(`CREATE TABLE IF NOT EXISTS "app"."orders"`);
    expect(ksIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThan(ksIdx);
  });
});
