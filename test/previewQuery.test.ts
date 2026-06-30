import { describe, expect, it } from "vitest";
import {
  buildPreviewQueryClauses,
  decodeCursor,
  encodeCursor,
} from "../src/core/postgres/previewQuery";
import { PreviewQuery } from "../src/core/shared/messages";

describe("Postgres preview query builder", () => {
  it("returns empty clauses for an absent query", () => {
    const clauses = buildPreviewQueryClauses(undefined);
    expect(clauses.whereSql).toBe("");
    expect(clauses.orderBySql).toBe("");
    expect(clauses.params).toEqual([]);
    expect(clauses.sort).toEqual([]);
  });

  it("builds a parameterized WHERE for each operator", () => {
    const query: PreviewQuery = {
      filters: [
        { column: "id", op: "eq", value: "7" },
        { column: "name", op: "neq", value: "x" },
        { column: "age", op: "gte", value: "18" },
        { column: "score", op: "lt", value: "90" },
      ],
    };
    const clauses = buildPreviewQueryClauses(query);
    expect(clauses.whereSql).toBe(
      'WHERE "id" = $1 AND "name" <> $2 AND "age" >= $3 AND "score" < $4',
    );
    expect(clauses.params).toEqual(["7", "x", "18", "90"]);
  });

  it("maps `contains` to an escaped case-insensitive ILIKE", () => {
    const clauses = buildPreviewQueryClauses({
      filters: [{ column: "email", op: "contains", value: "a%_b" }],
    });
    expect(clauses.whereSql).toBe('WHERE "email" ILIKE $1');
    // 50%/_ in the user's text are escaped so they match literally.
    expect(clauses.params).toEqual(["%a\\%\\_b%"]);
  });

  it("quotes identifiers and doubles embedded quotes", () => {
    const clauses = buildPreviewQueryClauses({
      filters: [{ column: 'we"ird', op: "eq", value: "1" }],
    });
    expect(clauses.whereSql).toBe('WHERE "we""ird" = $1');
  });

  it("honours a custom start index for placeholders", () => {
    const clauses = buildPreviewQueryClauses(
      { filters: [{ column: "a", op: "eq", value: "1" }] },
      3,
    );
    expect(clauses.whereSql).toBe('WHERE "a" = $3');
  });

  it("emits ORDER BY with per-column direction", () => {
    const clauses = buildPreviewQueryClauses({
      sort: [
        { column: "created", dir: "desc" },
        { column: "id", dir: "asc" },
      ],
    });
    expect(clauses.orderBySql).toBe('ORDER BY "created" DESC, "id" ASC');
  });

  it("ignores a cursor when no sort is present (no key to compare)", () => {
    const cursor = encodeCursor({ id: "5" }, [{ column: "id", dir: "asc" }])!;
    const clauses = buildPreviewQueryClauses({ cursor });
    expect(clauses.whereSql).toBe("");
  });

  it("builds a single-column keyset predicate from a cursor", () => {
    const cursor = encodeCursor({ id: "5" }, [{ column: "id", dir: "asc" }])!;
    const clauses = buildPreviewQueryClauses({
      sort: [{ column: "id", dir: "asc" }],
      cursor,
    });
    expect(clauses.whereSql).toBe('WHERE (("id" > $1))');
    expect(clauses.params).toEqual(["5"]);
  });

  it("builds a lexicographic keyset predicate for a mixed-direction sort", () => {
    const sort: PreviewQuery["sort"] = [
      { column: "a", dir: "asc" },
      { column: "b", dir: "desc" },
    ];
    const cursor = encodeCursor({ a: "10", b: "20" }, sort!)!;
    const clauses = buildPreviewQueryClauses({ sort, cursor });
    // asc → `>`, desc → `<`; second term pins the equal prefix.
    expect(clauses.whereSql).toBe(
      'WHERE (("a" > $1) OR ("a" = $1 AND "b" < $2))',
    );
    expect(clauses.params).toEqual(["10", "20"]);
  });

  it("folds filters AND keyset predicate into one WHERE", () => {
    const sort: PreviewQuery["sort"] = [{ column: "id", dir: "asc" }];
    const cursor = encodeCursor({ id: "5" }, sort!)!;
    const clauses = buildPreviewQueryClauses({
      filters: [{ column: "status", op: "eq", value: "open" }],
      sort,
      cursor,
    });
    expect(clauses.whereSql).toBe('WHERE "status" = $1 AND (("id" > $2))');
    expect(clauses.params).toEqual(["open", "5"]);
  });
});

describe("Postgres keyset cursor encode/decode", () => {
  it("round-trips the sort-key values", () => {
    const cursor = encodeCursor({ a: "1", b: "two" }, [
      { column: "a", dir: "asc" },
      { column: "b", dir: "desc" },
    ]);
    expect(cursor).toBeTypeOf("string");
    expect(decodeCursor(cursor!)).toEqual(["1", "two"]);
  });

  it("returns undefined when a sort column is missing from the row", () => {
    expect(encodeCursor({ a: "1" }, [{ column: "b", dir: "asc" }])).toBeUndefined();
  });

  it("returns undefined when decoding garbage", () => {
    expect(decodeCursor("not-base64-$$$")).toBeUndefined();
    expect(decodeCursor(Buffer.from('{"x":1}').toString("base64"))).toBeUndefined();
  });
});
