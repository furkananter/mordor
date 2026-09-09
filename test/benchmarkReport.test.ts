import { describe, expect, it } from "vitest";
import { BenchmarkStepResult } from "../src/core/cassandra/benchmark";
import { buildBenchmarkComparisonMarkdown } from "../src/core/cassandra/benchmarkReport";

function step(overrides: Partial<BenchmarkStepResult> = {}): BenchmarkStepResult {
  return {
    stepId: "s1",
    cql: "SELECT * FROM users",
    executions: 10,
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
        steps: [step({ stepId: "s1", avgMs: 20 }), step({ stepId: "s2", avgMs: 10 })],
      },
      after: {
        label: "after",
        ranAt: 1000,
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
});
