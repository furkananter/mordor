import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BenchmarkStepResult } from "../../core/cassandra/benchmark";

export interface BenchmarkStep {
  id: string;
  source: "saved" | "adhoc";
  savedQueryId?: string;
  cql?: string;
  repeat: number;
  concurrency: number;
}

export interface BenchmarkScenario {
  id: string;
  name: string;
  /** Optional owning profile; absent = available across profiles. */
  profileId?: string;
  steps: BenchmarkStep[];
}

export interface BenchmarkRun {
  id: string;
  scenarioId: string;
  profileId: string;
  ranAt: number;
  /** User-supplied, e.g. "baseline — old schema". */
  label?: string;
  totalDurationMs: number;
  steps: BenchmarkStepResult[];
}

interface BenchmarkState {
  scenarios: BenchmarkScenario[];
  runs: BenchmarkRun[];
}

interface BenchmarkActions {
  createScenario(name: string, profileId?: string): BenchmarkScenario;
  renameScenario(id: string, name: string): void;
  deleteScenario(id: string): void;
  addStep(
    scenarioId: string,
    step: { source: "saved" | "adhoc"; savedQueryId?: string; cql?: string; repeat: number; concurrency: number },
  ): void;
  updateStep(
    scenarioId: string,
    stepId: string,
    patch: Partial<Pick<BenchmarkStep, "source" | "savedQueryId" | "cql" | "repeat" | "concurrency">>,
  ): void;
  removeStep(scenarioId: string, stepId: string): void;
  recordRun(run: Omit<BenchmarkRun, "id">): BenchmarkRun;
  deleteRun(id: string): void;
}

export const useBenchmarkStore = create<BenchmarkState & BenchmarkActions>()(
  persist(
    (set) => ({
      scenarios: [],
      runs: [],

      createScenario: (name, profileId) => {
        const scenario: BenchmarkScenario = {
          id: crypto.randomUUID(),
          name,
          steps: [],
          ...(profileId === undefined ? {} : { profileId }),
        };
        set((state) => ({ scenarios: [...state.scenarios, scenario] }));
        return scenario;
      },

      renameScenario: (id, name) =>
        set((state) => ({
          scenarios: state.scenarios.map((scenario) => (scenario.id === id ? { ...scenario, name } : scenario)),
        })),

      deleteScenario: (id) =>
        set((state) => ({
          scenarios: state.scenarios.filter((scenario) => scenario.id !== id),
          runs: state.runs.filter((run) => run.scenarioId !== id),
        })),

      addStep: (scenarioId, step) =>
        set((state) => ({
          scenarios: state.scenarios.map((scenario) => {
            if (scenario.id !== scenarioId) return scenario;
            const next: BenchmarkStep = {
              id: crypto.randomUUID(),
              source: step.source,
              repeat: step.repeat,
              concurrency: step.concurrency,
              ...(step.savedQueryId === undefined ? {} : { savedQueryId: step.savedQueryId }),
              ...(step.cql === undefined ? {} : { cql: step.cql }),
            };
            return { ...scenario, steps: [...scenario.steps, next] };
          }),
        })),

      updateStep: (scenarioId, stepId, patch) =>
        set((state) => ({
          scenarios: state.scenarios.map((scenario) =>
            scenario.id !== scenarioId
              ? scenario
              : {
                  ...scenario,
                  steps: scenario.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
                },
          ),
        })),

      removeStep: (scenarioId, stepId) =>
        set((state) => ({
          scenarios: state.scenarios.map((scenario) =>
            scenario.id !== scenarioId
              ? scenario
              : { ...scenario, steps: scenario.steps.filter((step) => step.id !== stepId) },
          ),
        })),

      recordRun: (run) => {
        const next: BenchmarkRun = { id: crypto.randomUUID(), ...run };
        set((state) => ({ runs: [next, ...state.runs] }));
        return next;
      },

      deleteRun: (id) => set((state) => ({ runs: state.runs.filter((run) => run.id !== id) })),
    }),
    { name: "mordor-benchmark" },
  ),
);

export interface ResolvedStepOrError {
  stepId: string;
  cql?: string;
  repeat: number;
  concurrency: number;
  error?: string;
}

/**
 * Resolves each step of a scenario to the CQL it will actually run: ad-hoc
 * steps use their own text, saved-query steps look their `savedQueryId` up
 * in the passed-in saved queries. A step whose saved query was deleted, or
 * whose ad-hoc CQL is blank, comes back with `error` set instead of `cql` —
 * the caller (BenchmarkPanel) surfaces that and refuses to run.
 */
export function resolveScenarioSteps(
  scenario: Pick<BenchmarkScenario, "steps">,
  savedQueries: Array<{ id: string; sql: string }>,
): ResolvedStepOrError[] {
  return scenario.steps.map((step) => {
    if (step.source === "adhoc") {
      const cql = step.cql?.trim();
      if (!cql) {
        return { stepId: step.id, repeat: step.repeat, concurrency: step.concurrency, error: "Ad-hoc step has no CQL." };
      }
      return { stepId: step.id, cql, repeat: step.repeat, concurrency: step.concurrency };
    }
    const saved = savedQueries.find((query) => query.id === step.savedQueryId);
    if (!saved) {
      return { stepId: step.id, repeat: step.repeat, concurrency: step.concurrency, error: "Saved query no longer exists." };
    }
    return { stepId: step.id, cql: saved.sql, repeat: step.repeat, concurrency: step.concurrency };
  });
}
