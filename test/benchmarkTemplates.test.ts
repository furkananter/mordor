import { describe, expect, it } from "vitest";
import {
  BENCHMARK_TEMPLATES,
  findBenchmarkTemplate,
  hasUnfilledPlaceholder,
  templateTargetFromSchema,
} from "../src/core/cassandra/benchmarkTemplates";

const target = { keyspace: "app", table: "users" };

describe("BENCHMARK_TEMPLATES", () => {
  it("exposes uniquely-identified templates with a name and description", () => {
    const ids = BENCHMARK_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of BENCHMARK_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  it("builds at least one step per template, always qualified with the target table", () => {
    for (const template of BENCHMARK_TEMPLATES) {
      const steps = template.buildSteps(target);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.cql).toContain("app.users");
        expect(step.repeat).toBeGreaterThan(0);
        expect(step.concurrency).toBeGreaterThan(0);
      }
    }
  });

  it("flags exactly the templates that write data", () => {
    const mutating = BENCHMARK_TEMPLATES.filter((template) => template.mutates).map((t) => t.id);
    expect(mutating).toEqual(["write-throughput", "mixed-read-write"]);
    // A mutating template must actually contain a mutation, and a read-only
    // one must not — this is what the read/write query-mode gate relies on.
    for (const template of BENCHMARK_TEMPLATES) {
      const cql = template.buildSteps(target).map((step) => step.cql).join("\n");
      expect(/\b(INSERT|UPDATE|DELETE)\b/i.test(cql)).toBe(template.mutates);
    }
  });

  it("makes the full-scan template runnable as-is, with no placeholders left", () => {
    const [step] = findBenchmarkTemplate("full-scan")!.buildSteps(target);
    expect(step!.cql).toBe("SELECT * FROM app.users LIMIT 1000");
    expect(hasUnfilledPlaceholder(step!.cql)).toBe(false);
  });

  it("leaves an explicit placeholder where the user must supply a key or columns", () => {
    const pointRead = findBenchmarkTemplate("point-read")!.buildSteps(target);
    expect(pointRead[0]!.cql).toContain("<partition_key>");
    expect(hasUnfilledPlaceholder(pointRead[0]!.cql)).toBe(true);

    const write = findBenchmarkTemplate("write-throughput")!.buildSteps(target);
    expect(write[0]!.cql).toContain("<columns>");
  });

  it("tunes the point read for latency and the scans for lower concurrency", () => {
    const pointRead = findBenchmarkTemplate("point-read")!.buildSteps(target)[0]!;
    expect(pointRead).toMatchObject({ repeat: 500, concurrency: 32 });
    const fullScan = findBenchmarkTemplate("full-scan")!.buildSteps(target)[0]!;
    expect(fullScan).toMatchObject({ repeat: 50, concurrency: 4 });
  });

  it("orders the mixed template write-then-read", () => {
    const steps = findBenchmarkTemplate("mixed-read-write")!.buildSteps(target);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.cql).toMatch(/^INSERT/);
    expect(steps[1]!.cql).toMatch(/^SELECT/);
  });

  it("returns undefined for an unknown template id", () => {
    expect(findBenchmarkTemplate("nope")).toBeUndefined();
  });
});

describe("templateTargetFromSchema", () => {
  it("picks the first keyspace that actually has a table", () => {
    expect(
      templateTargetFromSchema([
        { name: "empty_ks", tables: [] },
        { name: "app", tables: [{ name: "users" }, { name: "orders" }] },
      ]),
    ).toEqual({ keyspace: "app", table: "users" });
  });

  it("falls back to placeholders when no table is available", () => {
    expect(templateTargetFromSchema([])).toEqual({
      keyspace: "<keyspace>",
      table: "<table>",
    });
    expect(templateTargetFromSchema([{ name: "app", tables: [] }])).toEqual({
      keyspace: "<keyspace>",
      table: "<table>",
    });
  });
});

describe("hasUnfilledPlaceholder", () => {
  it("detects angle-bracket placeholders and ignores ordinary CQL", () => {
    expect(hasUnfilledPlaceholder("SELECT * FROM app.users LIMIT 10")).toBe(false);
    expect(hasUnfilledPlaceholder("SELECT * FROM app.users WHERE <partition_key> = <value>")).toBe(true);
    // Comparison operators must not read as placeholders.
    expect(hasUnfilledPlaceholder("SELECT * FROM app.t WHERE a < 3 AND b > 1")).toBe(false);
  });
});
