import { describe, expect, it } from "vitest";
import { buildTablePreviewQuery, quoteIdentifier } from "../src/core/cassandra/cql";

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
