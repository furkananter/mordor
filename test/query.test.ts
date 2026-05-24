import { describe, expect, it } from "vitest";
import { normalizeQuery, normalizeSelectQuery } from "../src/core/cassandra/query";

describe("CQL query normalization", () => {
  it("adds the default LIMIT when missing on SELECT", () => {
    expect(normalizeSelectQuery("SELECT * FROM users")).toEqual({
      cql: "SELECT * FROM users LIMIT 1000",
      limit: 1000,
      isSelect: true
    });
  });

  it("keeps an existing LIMIT clause", () => {
    expect(normalizeSelectQuery("SELECT id FROM users LIMIT 25;").cql).toBe("SELECT id FROM users LIMIT 25");
  });

  it("read mode rejects non-select, multi statements, and DDL", () => {
    expect(() => normalizeSelectQuery("UPDATE users SET name = 'x' WHERE id = 1")).toThrow(
      "Read-only mode allows SELECT only"
    );
    expect(() => normalizeSelectQuery("SELECT * FROM users; DROP TABLE users")).toThrow(
      "Only a single statement is allowed."
    );
  });

  it("rejects empty input", () => {
    expect(() => normalizeSelectQuery(" ")).toThrow("CQL query is required.");
  });

  it("allows semicolons inside string literals", () => {
    expect(normalizeSelectQuery("SELECT * FROM users WHERE note = 'a;b'").cql).toBe(
      "SELECT * FROM users WHERE note = 'a;b' LIMIT 1000"
    );
  });

  it("write mode allows DML but blocks DDL", () => {
    expect(normalizeQuery("UPDATE users SET name = 'x' WHERE id = 1", "write").cql).toBe(
      "UPDATE users SET name = 'x' WHERE id = 1"
    );
    expect(() => normalizeQuery("DROP TABLE users", "write")).toThrow(
      "Write mode does not allow DDL"
    );
  });

  it("all mode allows DDL", () => {
    expect(normalizeQuery("DROP TABLE users", "all").cql).toBe("DROP TABLE users");
  });
});
