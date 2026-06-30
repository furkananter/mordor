import { describe, expect, it } from "vitest";
import { buildServerQuery } from "../src/renderer/components/ui/data-table/DataTable";

describe("buildServerQuery (table state → PreviewQuery)", () => {
  it("is undefined when nothing is filtered or sorted", () => {
    expect(buildServerQuery([], [])).toBeUndefined();
  });

  it("maps a non-empty text filter to a `contains` predicate", () => {
    expect(buildServerQuery([{ id: "name", value: "ab" }], [])).toEqual({
      filters: [{ column: "name", op: "contains", value: "ab" }],
    });
  });

  it("drops blank / whitespace-only text filters", () => {
    expect(buildServerQuery([{ id: "name", value: "   " }], [])).toBeUndefined();
  });

  it("maps a Date filter to an `eq` on its ISO string", () => {
    const date = new Date("2024-01-02T03:04:05.000Z");
    expect(buildServerQuery([{ id: "created", value: date }], [])).toEqual({
      filters: [{ column: "created", op: "eq", value: "2024-01-02T03:04:05.000Z" }],
    });
  });

  it("maps sorting to per-column direction", () => {
    expect(
      buildServerQuery([], [
        { id: "created", desc: true },
        { id: "id", desc: false },
      ]),
    ).toEqual({
      sort: [
        { column: "created", dir: "desc" },
        { column: "id", dir: "asc" },
      ],
    });
  });

  it("combines filters and sort", () => {
    expect(
      buildServerQuery([{ id: "name", value: "x" }], [{ id: "name", desc: false }]),
    ).toEqual({
      filters: [{ column: "name", op: "contains", value: "x" }],
      sort: [{ column: "name", dir: "asc" }],
    });
  });
});
