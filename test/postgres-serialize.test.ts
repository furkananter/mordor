import { describe, expect, it } from "vitest";
import { serializePostgresRows } from "../src/core/postgres/serialize";

describe("serializePostgresRows", () => {
  it("stringifies primitive values", () => {
    const rows = serializePostgresRows([
      { id: 1, name: "alice", active: true, score: 12.5 }
    ]);
    expect(rows[0]).toEqual({ id: "1", name: "alice", active: "true", score: "12.5" });
  });

  it("renders nulls as empty strings", () => {
    const rows = serializePostgresRows([{ id: null, name: undefined }]);
    expect(rows[0]).toEqual({ id: "", name: "" });
  });

  it("formats dates as ISO strings", () => {
    const fixed = new Date("2024-01-15T12:34:56.000Z");
    const rows = serializePostgresRows([{ ts: fixed }]);
    expect(rows[0]?.ts).toBe("2024-01-15T12:34:56.000Z");
  });

  it("formats buffers as Postgres bytea hex literal", () => {
    const rows = serializePostgresRows([{ blob: Buffer.from([0xab, 0xcd]) }]);
    expect(rows[0]?.blob).toBe("\\xabcd");
  });

  it("formats arrays as Postgres array literal", () => {
    const rows = serializePostgresRows([{ tags: ["a", "b", "c"] }]);
    expect(rows[0]?.tags).toBe('{"a","b","c"}');
  });

  it("stringifies nested objects as JSON", () => {
    const rows = serializePostgresRows([{ payload: { x: 1, y: [2, 3] } }]);
    expect(rows[0]?.payload).toBe('{"x":1,"y":[2,3]}');
  });

  it("handles bigint", () => {
    const rows = serializePostgresRows([{ big: 9007199254740993n }]);
    expect(rows[0]?.big).toBe("9007199254740993");
  });
});
