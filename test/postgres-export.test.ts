import { describe, expect, it } from "vitest";
import {
  PostgresExportTable,
  pgLiteral,
  renderCreateTable,
  renderInsert,
  renderSchemaScript,
} from "../src/core/postgres/exportRenderer";

const ORDERS_TABLE: PostgresExportTable = {
  schema: "public",
  name: "orders",
  kind: "BASE TABLE",
  columns: [
    { name: "id", dataType: "uuid", udtName: "uuid", isNullable: false, columnDefault: null },
    { name: "total", dataType: "numeric", udtName: "numeric", isNullable: true, columnDefault: null },
    { name: "metadata", dataType: "jsonb", udtName: "jsonb", isNullable: true, columnDefault: null },
    { name: "tags", dataType: "ARRAY", udtName: "_text", isNullable: true, columnDefault: null },
    { name: "status", dataType: "USER-DEFINED", udtName: "order_status", isNullable: false, columnDefault: "'pending'::order_status" },
  ],
  primaryKey: ["id"],
};

describe("pgLiteral", () => {
  it("renders null + boolean + number primitives", () => {
    expect(pgLiteral(null)).toBe("NULL");
    expect(pgLiteral(undefined)).toBe("NULL");
    expect(pgLiteral(true)).toBe("TRUE");
    expect(pgLiteral(false)).toBe("FALSE");
    expect(pgLiteral(42)).toBe("42");
    expect(pgLiteral(0.5)).toBe("0.5");
    expect(pgLiteral(BigInt("9223372036854775807"))).toBe("9223372036854775807");
  });
  it("quotes strings with escape", () => {
    expect(pgLiteral("hello")).toBe("'hello'");
    expect(pgLiteral("it's fine")).toBe("'it''s fine'");
  });
  it("casts Date as timestamptz", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(pgLiteral(date)).toBe("'2026-01-01T00:00:00.000Z'::timestamptz");
  });
  it("renders Buffer as bytea hex literal", () => {
    expect(pgLiteral(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe("'\\xdeadbeef'::bytea");
  });
  it("emits JSONB cast for objects (json cast when column type is json)", () => {
    expect(pgLiteral({ a: 1, b: "x" })).toBe(`'{"a":1,"b":"x"}'::jsonb`);
    expect(
      pgLiteral(
        { id: 1 },
        { name: "data", dataType: "json", udtName: "json", isNullable: true, columnDefault: null },
      ),
    ).toBe(`'{"id":1}'::json`);
  });
  it("renders arrays as Postgres array literal with quoted elements", () => {
    expect(pgLiteral(["a", "b", null, "with,comma"])).toBe(`'{"a","b",NULL,"with,comma"}'`);
  });
  it("emits enum cast when column type is USER-DEFINED", () => {
    expect(
      pgLiteral("pending", {
        name: "status",
        dataType: "USER-DEFINED",
        udtName: "order_status",
        isNullable: false,
        columnDefault: null,
      }),
    ).toBe(`'pending'::"order_status"`);
  });
  it("handles non-finite numbers with quoted casts", () => {
    expect(pgLiteral(Number.NaN)).toBe("'NaN'::float8");
    expect(pgLiteral(Number.POSITIVE_INFINITY)).toBe("'Infinity'::float8");
    expect(pgLiteral(Number.NEGATIVE_INFINITY)).toBe("'-Infinity'::float8");
  });
});

describe("renderCreateTable", () => {
  it("emits quoted identifiers + types + NOT NULL + defaults + PK", () => {
    const sql = renderCreateTable(ORDERS_TABLE);
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "public"."orders"`);
    expect(sql).toContain(`"id" uuid NOT NULL`);
    expect(sql).toContain(`"total" numeric`);
    expect(sql).toContain(`"tags" text[]`); // ARRAY + _text → text[]
    expect(sql).toContain(`"status" "order_status" NOT NULL DEFAULT 'pending'::order_status`);
    expect(sql).toContain(`PRIMARY KEY ("id")`);
  });
  it("omits PRIMARY KEY when the table has none", () => {
    const noPk: PostgresExportTable = { ...ORDERS_TABLE, primaryKey: [] };
    expect(renderCreateTable(noPk)).not.toContain("PRIMARY KEY");
  });
});

describe("renderInsert", () => {
  it("emits one INSERT row with all columns in declared order", () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      total: 12.5,
      metadata: { coupon: "X" },
      tags: ["new", "vip"],
      status: "pending",
    };
    const sql = renderInsert(ORDERS_TABLE, row);
    expect(sql).toBe(
      `INSERT INTO "public"."orders" ("id", "total", "metadata", "tags", "status") VALUES (` +
        `'11111111-1111-1111-1111-111111111111', 12.5, '{"coupon":"X"}'::jsonb, '{"new","vip"}', 'pending'::"order_status"` +
        `);`,
    );
  });
  it("emits NULL for missing fields rather than failing", () => {
    const sql = renderInsert(ORDERS_TABLE, {
      id: "abc",
      total: null,
      metadata: null,
      tags: null,
      status: "shipped",
    });
    expect(sql).toContain("NULL, NULL, NULL");
  });
});

describe("renderSchemaScript", () => {
  it("creates each schema + table in dependency-safe order", () => {
    const script = renderSchemaScript([
      {
        name: "public",
        tables: [
          ORDERS_TABLE,
          {
            schema: "public",
            name: "orders_view",
            kind: "VIEW",
            columns: [],
            primaryKey: [],
            viewDefinition: "SELECT * FROM orders",
          },
        ],
      },
    ]);
    const schemaIdx = script.indexOf(`CREATE SCHEMA IF NOT EXISTS "public"`);
    const tableIdx = script.indexOf(`CREATE TABLE IF NOT EXISTS "public"."orders"`);
    const viewIdx = script.indexOf(`CREATE OR REPLACE VIEW "public"."orders_view"`);
    expect(schemaIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThan(schemaIdx); // schema before tables
    expect(viewIdx).toBeGreaterThan(tableIdx); // base tables before views
  });
});
