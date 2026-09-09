import { describe, expect, it, vi } from "vitest";
import { computeStepMetrics, executeBenchmarkSteps } from "../src/core/cassandra/benchmark";

describe("computeStepMetrics", () => {
  it("computes min/avg/percentiles/max/throughput from durations", () => {
    const result = computeStepMetrics("s1", "SELECT 1", [10, 20, 30, 40, 50], 0, 1000);
    expect(result).toMatchObject({
      stepId: "s1",
      cql: "SELECT 1",
      executions: 5,
      errors: 0,
      minMs: 10,
      avgMs: 30,
      p50Ms: 30,
      maxMs: 50,
    });
    expect(result.throughputOpsPerSec).toBeCloseTo(5, 5);
  });

  it("counts executions as durations + errors", () => {
    const result = computeStepMetrics("s1", "SELECT 1", [10, 20], 3, 1000);
    expect(result.executions).toBe(5);
    expect(result.errors).toBe(3);
  });

  it("returns zeros (not NaN/Infinity) for a step with no successful executions", () => {
    const result = computeStepMetrics("s1", "SELECT 1", [], 4, 1000);
    expect(result).toMatchObject({
      minMs: 0,
      avgMs: 0,
      maxMs: 0,
      throughputOpsPerSec: 0,
      executions: 4,
      errors: 4,
    });
  });
});

describe("executeBenchmarkSteps", () => {
  it("runs each step's repeat count across concurrency workers", async () => {
    const calls: string[] = [];
    const execute = vi.fn(async (cql: string) => {
      calls.push(cql);
    });
    const result = await executeBenchmarkSteps(execute, [
      { stepId: "s1", cql: "SELECT 1", repeat: 5, concurrency: 2 },
    ]);
    expect(execute).toHaveBeenCalledTimes(5);
    expect(calls).toEqual(Array(5).fill("SELECT 1"));
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ stepId: "s1", executions: 5, errors: 0 });
  });

  it("counts individual execution failures without aborting the step", async () => {
    let call = 0;
    const execute = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error("boom");
    });
    const result = await executeBenchmarkSteps(execute, [
      { stepId: "s1", cql: "SELECT 1", repeat: 3, concurrency: 1 },
    ]);
    expect(result.steps[0]).toMatchObject({ executions: 3, errors: 1 });
  });

  it("calls onStep once per step, in order, with that step's result", async () => {
    const execute = vi.fn(async () => undefined);
    const seen: string[] = [];
    await executeBenchmarkSteps(
      execute,
      [
        { stepId: "s1", cql: "SELECT 1", repeat: 1, concurrency: 1 },
        { stepId: "s2", cql: "SELECT 2", repeat: 1, concurrency: 1 },
      ],
      (result) => seen.push(result.stepId),
    );
    expect(seen).toEqual(["s1", "s2"]);
  });
});
