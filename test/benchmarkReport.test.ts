import { describe, expect, it } from "vitest";
import { BenchmarkStepResult } from "../src/core/cassandra/benchmark";
import {
  buildBenchmarkComparisonMarkdown,
  compareBenchmarkRuns,
  deriveBenchmarkRunOutcome,
} from "../src/core/cassandra/benchmarkReport";

function step(overrides: Partial<BenchmarkStepResult> = {}): BenchmarkStepResult {
  return {
    stepId: "s1",
    cql: "SELECT * FROM users",
    repeat: 10,
    concurrency: 2,
    executions: 10,
    successfulExecutions: 10,
    errors: 0,
    minMs: 5,
    avgMs: 10,
    p50Ms: 9,
    p95Ms: 20,
    p99Ms: 25,
    maxMs: 30,
    throughputOpsPerSec: 100,
    ...overrides,
  };
}

describe("buildBenchmarkComparisonMarkdown", () => {
  it("includes both run labels and a per-step metrics table", () => {
    const markdown = buildBenchmarkComparisonMarkdown({
      scenarioName: "users read path",
      before: { label: "baseline — old schema", ranAt: 0, steps: [step({ avgMs: 20 })] },
      after: { label: "v2 schema", ranAt: 1000, steps: [step({ avgMs: 10 })] },
    });
    expect(markdown).toContain("# Benchmark Comparison — users read path");
    expect(markdown).toContain("baseline — old schema");
    expect(markdown).toContain("v2 schema");
    expect(markdown).toContain("avg ms | 20.0 | 10.0 | -50.0%");
  });

  it("summarizes how many steps got faster vs regressed", () => {
    const markdown = buildBenchmarkComparisonMarkdown({
      scenarioName: "mix",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "s1", avgMs: 20 }), step({ stepId: "s2", avgMs: 10 })],
      },
      after: {
        label: "after",
        ranAt: 1000,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "s1", avgMs: 10 }), step({ stepId: "s2", avgMs: 15 })],
      },
    });
    expect(markdown).toContain("1 of 2 step(s) got faster");
    expect(markdown).toContain("1 regressed (worst: +50.0% avg latency)");
  });

  it("marks a step with no counterpart run as unmatched instead of crashing", () => {
    const markdown = buildBenchmarkComparisonMarkdown({
      scenarioName: "extra step",
      before: { label: "before", ranAt: 0, steps: [step()] },
      after: { label: "after", ranAt: 1000, steps: [step(), step({ stepId: "s2" })] },
    });
    expect(markdown).toContain("no matching run");
  });

  it("reports n/a instead of dividing by zero when the baseline metric is 0", () => {
    const markdown = buildBenchmarkComparisonMarkdown({
      scenarioName: "zero baseline",
      before: { label: "before", ranAt: 0, steps: [step({ avgMs: 0 })] },
      after: { label: "after", ranAt: 1000, steps: [step({ avgMs: 5 })] },
    });
    expect(markdown).toContain("avg ms | 0.0 | 5.0 | n/a");
  });

  it("matches reordered steps by stable step ID", () => {
    const comparison = compareBenchmarkRuns({
      scenarioName: "reordered",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "s1", avgMs: 20 }), step({ stepId: "s2", avgMs: 30, cql: "SELECT 2" })],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "s2", avgMs: 15, cql: "SELECT 2" }), step({ stepId: "s1", avgMs: 10 })],
      },
    });
    expect(comparison.steps.map((item) => item.stepId)).toEqual(["s1", "s2"]);
    expect(comparison.fasterCount).toBe(2);
    expect(comparison.steps.every((item) => item.kind === "matched")).toBe(true);
  });

  it("keeps replacement, added, and removed steps unmatched", () => {
    const comparison = compareBenchmarkRuns({
      scenarioName: "shape change",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "old", cql: "SELECT old" })],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "new", cql: "SELECT new" })],
      },
    });
    expect(comparison.steps.map((item) => [item.stepId, item.kind])).toEqual([
      ["old", "removed"],
      ["new", "added"],
    ]);
    expect(comparison.fasterCount).toBe(0);
    expect(comparison.regressedCount).toBe(0);
  });

  it("retains paired metrics but suppresses verdicts for changed CQL", () => {
    const markdown = buildBenchmarkComparisonMarkdown({
      scenarioName: "schema adaptation",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ cql: "SELECT old", avgMs: 20 })],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ cql: "SELECT new", avgMs: 10 })],
      },
    });
    expect(markdown).toContain("changed workload");
    expect(markdown).toContain("before: `SELECT old`<br>after: `SELECT new`");
    expect(markdown).toContain("No verified comparable steps");
  });

  it("derives completed with errors and failed outcomes without partial claims", () => {
    expect(deriveBenchmarkRunOutcome({ steps: [step({ executions: 10, errors: 2, successfulExecutions: 8 })] })).toBe(
      "completed_with_errors",
    );
    expect(deriveBenchmarkRunOutcome({ steps: [step({ executions: 10, errors: 10, successfulExecutions: 0 })] })).toBe(
      "failed",
    );
  });

  it("suppresses verdicts when either run has errors or zero successful operations", () => {
    const comparison = compareBenchmarkRuns({
      scenarioName: "errors",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ errors: 1, executions: 10, successfulExecutions: 9 })],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ avgMs: 5, errors: 10, executions: 10, successfulExecutions: 0 })],
      },
    });
    expect(comparison.beforeOutcome).toBe("completed_with_errors");
    expect(comparison.afterOutcome).toBe("failed");
    expect(comparison.fasterCount).toBe(0);
    expect(comparison.regressedCount).toBe(0);
    expect(comparison.steps[0]?.verdict).toBe("unverified");
  });

  it("suppresses every paired verdict when any step in either run is invalid", () => {
    const comparison = compareBenchmarkRuns({
      scenarioName: "mixed validity",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [
          step({ stepId: "s1", avgMs: 20, errors: 1, executions: 10, successfulExecutions: 9 }),
          step({ stepId: "s2", avgMs: 20 }),
        ],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ stepId: "s1", avgMs: 10 }), step({ stepId: "s2", avgMs: 10 })],
      },
    });
    expect(comparison.steps.filter((item) => item.verdict === "faster")).toHaveLength(0);
    expect(comparison.steps.filter((item) => item.verdict === "regressed")).toHaveLength(0);
    expect(comparison.steps.every((item) => item.verdict === "unverified")).toBe(true);
  });

  it("treats zero-success metrics as invalid even without an error count", () => {
    const comparison = compareBenchmarkRuns({
      scenarioName: "empty metrics",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ avgMs: 20, executions: 0, successfulExecutions: 0 })],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ avgMs: 10 })],
      },
    });
    expect(comparison.eligibility.status).toBe("unverified");
    expect(comparison.fasterCount).toBe(0);
    expect(comparison.steps[0]?.verdict).toBe("unverified");
  });

  it("marks profile and benchmark setting mismatches incompatible", () => {
    const comparison = compareBenchmarkRuns({
      scenarioName: "settings",
      before: {
        label: "before",
        ranAt: 0,
        profileId: "p1",
        queryMode: "read",
        steps: [step({ repeat: 10, concurrency: 2 })],
      },
      after: {
        label: "after",
        ranAt: 1,
        profileId: "p2",
        queryMode: "write",
        steps: [step({ repeat: 20, concurrency: 4, avgMs: 5 })],
      },
    });
    expect(comparison.eligibility.status).toBe("incompatible");
    expect(comparison.steps[0]?.verdict).toBe("unverified");
  });

  it("marks legacy runs with missing metadata unverified", () => {
    const { repeat: _beforeRepeat, concurrency: _beforeConcurrency, ...beforeLegacyStep } = step();
    const { repeat: _afterRepeat, concurrency: _afterConcurrency, ...afterLegacyStep } = step({ avgMs: 5 });
    const comparison = compareBenchmarkRuns({
      scenarioName: "legacy",
      before: { label: "before", ranAt: 0, steps: [beforeLegacyStep] },
      after: { label: "after", ranAt: 1, steps: [afterLegacyStep] },
    });
    expect(comparison.eligibility.status).toBe("unverified");
    expect(comparison.steps[0]?.verdict).toBe("unverified");
  });
});
