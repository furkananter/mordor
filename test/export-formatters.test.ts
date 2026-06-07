import { describe, expect, it } from "vitest";
import {
  csvField,
  csvRow,
  folderSlug,
  quoteIdent,
  quoteSqlString,
  timestampSuffix,
} from "../src/core/export/formatters";

describe("quoteSqlString", () => {
  it("wraps in single quotes and doubles internal single quotes", () => {
    expect(quoteSqlString("plain")).toBe("'plain'");
    expect(quoteSqlString("it's mine")).toBe("'it''s mine'");
    expect(quoteSqlString("")).toBe("''");
  });
});

describe("quoteIdent", () => {
  it('wraps in double quotes and doubles internal double quotes', () => {
    expect(quoteIdent("public")).toBe('"public"');
    expect(quoteIdent('weird "name"')).toBe('"weird ""name"""');
  });
});

describe("csvField", () => {
  it("leaves bare ASCII unquoted", () => {
    expect(csvField("hello")).toBe("hello");
    expect(csvField("123")).toBe("123");
  });
  it("quotes + escapes when special chars are present", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('a"b')).toBe('"a""b"');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
  it("treats empty as bare empty (Excel-friendly)", () => {
    expect(csvField("")).toBe("");
  });
});

describe("csvRow", () => {
  it("joins with commas + CRLF terminator", () => {
    expect(csvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
  });
  it("escapes per-field then joins", () => {
    expect(csvRow(["plain", "needs,quoting", 'has "quotes"'])).toBe(
      'plain,"needs,quoting","has ""quotes"""\r\n',
    );
  });
});

describe("folderSlug", () => {
  it("lowercases + collapses non-alnum to single dashes", () => {
    expect(folderSlug("My Production Cluster")).toBe("my-production-cluster");
    expect(folderSlug("user@127.0.0.1:5432")).toBe("user-127-0-0-1-5432");
    expect(folderSlug("---weird---")).toBe("weird");
  });
  it("falls back to 'export' when nothing safe remains", () => {
    expect(folderSlug("!@#$%")).toBe("export");
  });
});

describe("timestampSuffix", () => {
  it("zero-pads to YYYYMMDD-HHmmss in UTC", () => {
    // 2026-01-05T03:04:05Z — every field needs padding to surface bugs in
    // single-digit handling.
    const fixed = new Date(Date.UTC(2026, 0, 5, 3, 4, 5));
    expect(timestampSuffix(fixed)).toBe("20260105-030405");
  });
});
