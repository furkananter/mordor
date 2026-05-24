import { describe, expect, it } from "vitest";
import { splitCqlStatements } from "../src/core/cassandra/cqlSplit";

describe("splitCqlStatements", () => {
  it("splits on semicolons", () => {
    const result = splitCqlStatements("CREATE TABLE a (id int PRIMARY KEY); CREATE TABLE b (id int PRIMARY KEY);");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("CREATE TABLE a (id int PRIMARY KEY)");
    expect(result[1]).toBe("CREATE TABLE b (id int PRIMARY KEY)");
  });

  it("ignores semicolons inside string literals", () => {
    const result = splitCqlStatements("INSERT INTO t (s) VALUES ('a;b'); SELECT 1;");
    expect(result).toEqual(["INSERT INTO t (s) VALUES ('a;b')", "SELECT 1"]);
  });

  it("handles escaped single quotes", () => {
    const result = splitCqlStatements("INSERT INTO t (s) VALUES ('it''s; ok'); SELECT 1;");
    expect(result).toEqual(["INSERT INTO t (s) VALUES ('it''s; ok')", "SELECT 1"]);
  });

  it("strips line comments", () => {
    const result = splitCqlStatements("-- comment with ;\nSELECT 1;\n// another;\nSELECT 2;");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("strips block comments", () => {
    const result = splitCqlStatements("/* hi; there */ SELECT 1; SELECT 2;");
    expect(result).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps BEGIN BATCH ... APPLY BATCH as one statement", () => {
    const script = `BEGIN BATCH
      INSERT INTO t (id) VALUES (1);
      INSERT INTO t (id) VALUES (2);
    APPLY BATCH;
    SELECT * FROM t;`;
    const result = splitCqlStatements(script);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("BEGIN BATCH");
    expect(result[0]).toContain("APPLY BATCH");
    expect(result[1]).toBe("SELECT * FROM t");
  });

  it("ignores trailing whitespace and empty statements", () => {
    expect(splitCqlStatements(";;\n  ;\nSELECT 1;  \n;")).toEqual(["SELECT 1"]);
  });

  it("returns empty for blank input", () => {
    expect(splitCqlStatements("")).toEqual([]);
    expect(splitCqlStatements("   \n\t")).toEqual([]);
  });
});
