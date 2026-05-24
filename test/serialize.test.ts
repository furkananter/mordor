import { describe, expect, it } from "vitest";
import { serializeCell, serializeRows } from "../src/core/cassandra/serialize";

describe("Cassandra value serialization", () => {
  it("serializes nullish values as empty display cells", () => {
    expect(serializeCell(null)).toBe("");
    expect(serializeCell(undefined)).toBe("");
  });

  it("serializes dates, buffers, arrays, sets, maps, and objects", () => {
    expect(serializeCell(new Date("2026-05-05T12:00:00.000Z"))).toBe("2026-05-05T12:00:00.000Z");
    expect(serializeCell(Buffer.from([10, 11]))).toBe("0x0a0b");
    expect(serializeCell(["a", 2])).toBe("[\"a\",2]");
    expect(serializeCell(new Set(["x", "y"]))).toBe("[\"x\",\"y\"]");
    expect(serializeCell(new Map([["k", Buffer.from([1])]]))).toBe("{\"k\":\"0x01\"}");
    expect(serializeCell({ nested: new Date("2026-05-05T12:00:00.000Z") })).toBe("{\"nested\":\"2026-05-05T12:00:00.000Z\"}");
  });

  it("serializes row records without changing column names", () => {
    expect(serializeRows([{ id: 1, active: true }])).toEqual([{ id: "1", active: "true" }]);
  });
});
