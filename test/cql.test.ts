import { describe, expect, it } from "vitest";
import {
  buildCqlPreviewClause,
  buildTablePreviewQuery,
  quoteIdentifier,
} from "../src/core/cassandra/cql";

describe("CQL helpers", () => {
  it("quotes identifiers and escapes embedded quotes", () => {
    expect(quoteIdentifier('customer"events')).toBe('"customer""events"');
  });

  it("builds an unbounded preview query — pagination is driven by fetchSize + pageState", () => {
    expect(buildTablePreviewQuery("app", "orders")).toBe('SELECT * FROM "app"."orders"');
  });

  it("rejects empty identifiers", () => {
    expect(() => quoteIdentifier("  ")).toThrow("CQL identifier cannot be empty.");
  });
});

describe("CQL preview filter clause", () => {
  const keys = new Set(["id", "bucket"]);

  it("is empty when no query is given", () => {
    const clause = buildCqlPreviewClause(undefined, keys);
    expect(clause.whereSql).toBe("");
    expect(clause.params).toEqual([]);
    expect(clause.needsAllowFiltering).toBe(false);
  });

  it("filters key columns by equality natively (no ALLOW FILTERING)", () => {
    const clause = buildCqlPreviewClause(
      { filters: [{ column: "id", op: "eq", value: "42" }] },
      keys,
    );
    expect(clause.whereSql).toBe(' WHERE "id" = ?');
    expect(clause.params).toEqual(["42"]);
    expect(clause.needsAllowFiltering).toBe(false);
  });

  it("forces ALLOW FILTERING for a non-key column filter", () => {
    const clause = buildCqlPreviewClause(
      { filters: [{ column: "status", op: "eq", value: "open" }] },
      keys,
    );
    expect(clause.whereSql).toBe(' WHERE "status" = ?');
    expect(clause.needsAllowFiltering).toBe(true);
  });

  it("forces ALLOW FILTERING for a non-equality predicate on a key column", () => {
    const clause = buildCqlPreviewClause(
      { filters: [{ column: "id", op: "gt", value: "10" }] },
      keys,
    );
    expect(clause.whereSql).toBe(' WHERE "id" > ?');
    expect(clause.needsAllowFiltering).toBe(true);
  });

  it("drops operators CQL can't express (neq, contains)", () => {
    const clause = buildCqlPreviewClause(
      {
        filters: [
          { column: "id", op: "neq", value: "1" },
          { column: "name", op: "contains", value: "ab" },
        ],
      },
      keys,
    );
    expect(clause.whereSql).toBe("");
    expect(clause.needsAllowFiltering).toBe(false);
  });

  it("joins multiple predicates with AND and binds each value", () => {
    const clause = buildCqlPreviewClause(
      {
        filters: [
          { column: "id", op: "eq", value: "1" },
          { column: "ts", op: "gte", value: "2024" },
        ],
      },
      keys,
    );
    expect(clause.whereSql).toBe(' WHERE "id" = ? AND "ts" >= ?');
    expect(clause.params).toEqual(["1", "2024"]);
    expect(clause.needsAllowFiltering).toBe(true);
  });
});
