import { describe, expect, it } from "vitest";
import {
  buildResultExport,
  toCsv,
  toJson,
  toSqlInserts
} from "../src/renderer/components/ui/data-table/exportResults";

const columns = ["id", "name", "note"];
const rows = [
  { id: "1", name: "Alice", note: "plain" },
  { id: "2", name: "Bob, Jr.", note: 'has "quotes"' },
  { id: "3", name: "line1\nline2", note: "" }
];

describe("toCsv", () => {
  it("emits a header row + CRLF-terminated rows", () => {
    const csv = toCsv(["a", "b"], [{ a: "1", b: "2" }]);
    expect(csv).toBe("a,b\r\n1,2\r\n");
  });

  it("escapes fields containing commas, quotes, and newlines", () => {
    const csv = toCsv(columns, rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("id,name,note");
    expect(lines[1]).toBe("1,Alice,plain");
    expect(lines[2]).toBe('2,"Bob, Jr.","has ""quotes"""');
    // Embedded newline forces quoting; the field itself still contains the LF.
    expect(csv).toContain('"line1\nline2"');
  });

  it("renders missing cells as empty fields", () => {
    const csv = toCsv(["a", "b"], [{ a: "x" }]);
    expect(csv).toBe("a,b\r\nx,\r\n");
  });
});

describe("toJson", () => {
  it("produces a pretty-printed array projected to the given columns", () => {
    const json = toJson(["id", "name"], rows);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob, Jr." },
      { id: "3", name: "line1\nline2" }
    ]);
    // Pretty-printed (two-space indent).
    expect(json).toContain("\n  ");
  });

  it("fills missing cells with empty strings for a uniform shape", () => {
    const parsed = JSON.parse(toJson(["a", "b"], [{ a: "x" }]));
    expect(parsed).toEqual([{ a: "x", b: "" }]);
  });
});

describe("toSqlInserts", () => {
  it("quotes identifiers + quotes every value as a string literal", () => {
    const sql = toSqlInserts("users", ["id", "name"], [{ id: "1", name: "Alice" }]);
    expect(sql).toBe('INSERT INTO "users" ("id", "name") VALUES (\'1\', \'Alice\');');
  });

  it("doubles internal single quotes in values", () => {
    const sql = toSqlInserts("t", ["name"], [{ name: "it's mine" }]);
    expect(sql).toBe('INSERT INTO "t" ("name") VALUES (\'it\'\'s mine\');');
  });

  it("escapes embedded double quotes in identifiers", () => {
    const sql = toSqlInserts('we"ird', ["c"], [{ c: "v" }]);
    expect(sql).toBe('INSERT INTO "we""ird" ("c") VALUES (\'v\');');
  });

  it("emits one statement per row separated by newlines", () => {
    const sql = toSqlInserts("t", ["id"], [{ id: "1" }, { id: "2" }]);
    expect(sql.split("\n")).toHaveLength(2);
  });

  it("treats missing cells as empty string literals", () => {
    const sql = toSqlInserts("t", ["a", "b"], [{ a: "x" }]);
    expect(sql).toBe('INSERT INTO "t" ("a", "b") VALUES (\'x\', \'\');');
  });
});

describe("buildResultExport", () => {
  it("returns csv content + metadata", () => {
    const out = buildResultExport("csv", ["a"], [{ a: "1" }]);
    expect(out.extension).toBe("csv");
    expect(out.mimeType).toContain("text/csv");
    expect(out.content).toBe("a\r\n1\r\n");
  });

  it("returns json content + metadata", () => {
    const out = buildResultExport("json", ["a"], [{ a: "1" }]);
    expect(out.extension).toBe("json");
    expect(out.mimeType).toContain("application/json");
    expect(JSON.parse(out.content)).toEqual([{ a: "1" }]);
  });

  it("uses the supplied table name for sql exports", () => {
    const out = buildResultExport("sql", ["a"], [{ a: "1" }], "people");
    expect(out.extension).toBe("sql");
    expect(out.content).toContain('INSERT INTO "people"');
  });

  it("falls back to a default table name when none is supplied", () => {
    const out = buildResultExport("sql", ["a"], [{ a: "1" }]);
    expect(out.content).toContain('INSERT INTO "exported_rows"');
  });
});
