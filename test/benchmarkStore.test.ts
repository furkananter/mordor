import { beforeEach, describe, expect, it } from "vitest";
import { resolveScenarioSteps, useBenchmarkStore } from "../src/renderer/store/benchmark";

function reset(): void {
  useBenchmarkStore.setState({ scenarios: [], runs: [] });
}

describe("benchmark store", () => {
  beforeEach(reset);

  it("creates a scenario with the given name and profile", () => {
    const scenario = useBenchmarkStore.getState().createScenario("Read path", "p1");
    expect(scenario).toMatchObject({ name: "Read path", profileId: "p1", steps: [] });
    expect(useBenchmarkStore.getState().scenarios).toHaveLength(1);
  });

  it("addStep appends a step with an id", () => {
    const scenario = useBenchmarkStore.getState().createScenario("s", "p1");
    useBenchmarkStore.getState().addStep(scenario.id, { source: "adhoc", cql: "SELECT 1", repeat: 10, concurrency: 2 });
    const [updated] = useBenchmarkStore.getState().scenarios;
    expect(updated!.steps).toHaveLength(1);
    expect(updated!.steps[0]).toMatchObject({ source: "adhoc", cql: "SELECT 1", repeat: 10, concurrency: 2 });
    expect(typeof updated!.steps[0]!.id).toBe("string");
  });

  it("updateStep patches only the targeted step", () => {
    const scenario = useBenchmarkStore.getState().createScenario("s", "p1");
    useBenchmarkStore.getState().addStep(scenario.id, { source: "adhoc", cql: "SELECT 1", repeat: 10, concurrency: 2 });
    const stepId = useBenchmarkStore.getState().scenarios[0]!.steps[0]!.id;
    useBenchmarkStore.getState().updateStep(scenario.id, stepId, { repeat: 50 });
    expect(useBenchmarkStore.getState().scenarios[0]!.steps[0]).toMatchObject({ repeat: 50, cql: "SELECT 1" });
  });

  it("removeStep drops only the targeted step", () => {
    const scenario = useBenchmarkStore.getState().createScenario("s", "p1");
    useBenchmarkStore.getState().addStep(scenario.id, { source: "adhoc", cql: "A", repeat: 1, concurrency: 1 });
    useBenchmarkStore.getState().addStep(scenario.id, { source: "adhoc", cql: "B", repeat: 1, concurrency: 1 });
    const [first, second] = useBenchmarkStore.getState().scenarios[0]!.steps;
    useBenchmarkStore.getState().removeStep(scenario.id, first!.id);
    const remaining = useBenchmarkStore.getState().scenarios[0]!.steps;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(second!.id);
  });

  it("deleteScenario removes the scenario and its runs", () => {
    const scenario = useBenchmarkStore.getState().createScenario("s", "p1");
    useBenchmarkStore.getState().recordRun({
      scenarioId: scenario.id,
      profileId: "p1",
      ranAt: 1,
      totalDurationMs: 10,
      steps: [],
    });
    useBenchmarkStore.getState().deleteScenario(scenario.id);
    expect(useBenchmarkStore.getState().scenarios).toHaveLength(0);
    expect(useBenchmarkStore.getState().runs).toHaveLength(0);
  });

  it("recordRun stores a run with a generated id, newest first", () => {
    const scenario = useBenchmarkStore.getState().createScenario("s", "p1");
    useBenchmarkStore.getState().recordRun({
      scenarioId: scenario.id,
      profileId: "p1",
      ranAt: 1,
      label: "before",
      totalDurationMs: 10,
      steps: [],
    });
    useBenchmarkStore.getState().recordRun({
      scenarioId: scenario.id,
      profileId: "p1",
      ranAt: 2,
      label: "after",
      totalDurationMs: 20,
      steps: [],
    });
    const { runs } = useBenchmarkStore.getState();
    expect(runs.map((r) => r.label)).toEqual(["after", "before"]);
  });
});

describe("resolveScenarioSteps", () => {
  const savedQueries = [{ id: "q1", sql: "SELECT * FROM users" }];

  it("resolves an ad-hoc step to its own CQL", () => {
    const scenario = {
      id: "sc1",
      name: "s",
      steps: [{ id: "st1", source: "adhoc" as const, cql: "SELECT 1", repeat: 5, concurrency: 1 }],
    };
    expect(resolveScenarioSteps(scenario, savedQueries)).toEqual([
      { stepId: "st1", cql: "SELECT 1", repeat: 5, concurrency: 1 },
    ]);
  });

  it("resolves a saved-query step by looking up its CQL", () => {
    const scenario = {
      id: "sc1",
      name: "s",
      steps: [{ id: "st1", source: "saved" as const, savedQueryId: "q1", repeat: 5, concurrency: 1 }],
    };
    expect(resolveScenarioSteps(scenario, savedQueries)).toEqual([
      { stepId: "st1", cql: "SELECT * FROM users", repeat: 5, concurrency: 1 },
    ]);
  });

  it("flags a saved-query step whose query no longer exists", () => {
    const scenario = {
      id: "sc1",
      name: "s",
      steps: [{ id: "st1", source: "saved" as const, savedQueryId: "missing", repeat: 5, concurrency: 1 }],
    };
    const [resolved] = resolveScenarioSteps(scenario, savedQueries);
    expect(resolved!.error).toBe("Saved query no longer exists.");
  });

  it("flags an ad-hoc step with blank CQL", () => {
    const scenario = {
      id: "sc1",
      name: "s",
      steps: [{ id: "st1", source: "adhoc" as const, cql: "   ", repeat: 5, concurrency: 1 }],
    };
    const [resolved] = resolveScenarioSteps(scenario, savedQueries);
    expect(resolved!.error).toBe("Ad-hoc step has no CQL.");
  });
});
