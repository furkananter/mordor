# Cassandra Benchmark

## Problem

We're planning to change the Cassandra data model/schema for this app. We need a way to
measure query performance against the current schema, then re-measure after the schema
change, and compare the two — without leaving Mordor. The comparison result also needs
to be exportable in a form we can hand to an AI assistant for analysis.

## Scope

- Cassandra only for v1 (Redis/Postgres benchmarking is out of scope; a future spec can
  extend the same pattern to other engines).
- A benchmark **scenario** is a named, reusable list of query steps. Each step is either
  a reference to an existing saved query (`queryHistory.ts`'s `SavedQuery`) or an ad-hoc
  CQL statement typed directly into the scenario editor.
- Running a scenario produces a **run**: per-step latency/throughput/error metrics, plus
  an optional user-supplied label (e.g. "baseline — old schema", "v2 schema").
- Runs of the same scenario can be compared pairwise (old vs new), and the comparison can
  be exported as a Markdown report meant to be handed to an AI for analysis.

## Non-goals

- Cross-engine comparison (same workload run against Cassandra and Postgres side by side).
- Time-boxed/continuous stress testing (only fixed repeat-count workloads for v1).
- Automatic schema-diff detection or auto-rewriting queries for a new schema — the user
  edits the scenario's CQL by hand when the schema changes.
- Multi-machine / distributed load generation — benchmarks run from the single Mordor
  process, same as every other query in the app.

## Architecture

A new **Benchmark** tab is added to the Cassandra profile workspace, alongside the
existing CQL Console and Schema tabs (same per-engine tab pattern already used for
Cassandra/Redis/Postgres workspaces).

**Renderer**
- `src/renderer/features/workspace/BenchmarkPanel.tsx` — scenario list, scenario editor
  (add/remove/reorder steps, pick saved query or write ad-hoc CQL, set repeat/concurrency
  per step), Run button with live progress, per-scenario run history, and a Compare view
  that picks two runs and renders a side-by-side diff table.
- `src/renderer/store/benchmarkStore.ts` — zustand store with `persist` middleware,
  following the same shape/persistence pattern as `queryHistory.ts`. Holds `scenarios`
  and `runs`, keyed and filtered by scenario id.

**Main process**
- `src/core/cassandra/benchmark.ts` — pure execution/aggregation logic: given a connected
  `cassandra.Client` and a scenario, runs each step's `repeat` executions across
  `concurrency` parallel workers, records per-execution duration and success/failure, and
  aggregates into the metrics below. No IPC or Electron APIs in this module — testable in
  isolation the way `query.ts` is.
- A new IPC handler (added alongside the existing ones in `src/main/handlers/`, e.g.
  `cassandra:run-benchmark`) drives `benchmark.ts` using the already-connected client from
  `CassandraService`'s active-connection map (no new connection is opened) and streams
  per-step progress events back to the renderer as steps complete.
- A new IPC handler for the comparison export (e.g. `cassandra:export-benchmark-report`)
  reuses the `dialog.showOpenDialog` folder-picker pattern from `export-handlers.ts`, then
  writes the generated Markdown report into the chosen folder on the main process side.

## Data model

```ts
interface BenchmarkStep {
  id: string;
  source: "saved" | "adhoc";
  savedQueryId?: string;   // set when source === "saved"
  cql?: string;            // set when source === "adhoc"
  repeat: number;          // total executions for this step
  concurrency: number;     // parallel workers for this step
}

interface BenchmarkScenario {
  id: string;
  name: string;
  profileId?: string;      // optional; absent = available across profiles
  steps: BenchmarkStep[];
}

interface BenchmarkStepResult {
  stepId: string;
  cql: string;              // the CQL actually executed (resolved saved-query snapshot)
  executions: number;
  errors: number;
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  throughputOpsPerSec: number;
}

interface BenchmarkRun {
  id: string;
  scenarioId: string;
  profileId: string;
  ranAt: number;             // epoch millis
  label?: string;            // user-supplied, e.g. "baseline — old schema"
  totalDurationMs: number;
  steps: BenchmarkStepResult[];
}
```

## Execution flow

1. User opens the Benchmark tab on a Cassandra connection and creates a scenario: adds
   steps, each sourced from a saved query or typed as ad-hoc CQL, with a repeat count and
   concurrency.
2. On **Run**, steps execute sequentially (one step completes before the next starts, so
   steps don't interfere with each other's measurements). Within a step, `repeat`
   executions run distributed across `concurrency` parallel workers against the existing
   connected client. Progress streams live to the UI.
3. Each individual execution's success/failure and duration are recorded; a failed
   execution is counted as an error and does not abort the run.
4. On completion the user is prompted for an optional label and the run is appended to
   that scenario's run history.
5. After the schema change, the user edits the scenario's steps (table/keyspace names,
   etc. as needed for the new schema) and runs it again with a new label.
6. In the Compare view the user picks any two runs of the same scenario. The UI renders a
   step-by-step table: old avg/p95/throughput/errors vs new avg/p95/throughput/errors,
   with a percentage delta (improved/regressed, color-coded).
7. From the Compare view, **Export Report** opens a folder picker and writes a Markdown
   file (`benchmark-compare-<scenario-name>-<date>.md`) containing: scenario name, both
   runs' labels/timestamps, the full step-by-step comparison table, and a short plain-text
   summary (e.g. "3 of 4 queries got faster; 1 regressed by 12%") intended for an AI to
   read and reason about directly, without needing the raw JSON.

## Metrics

Per step: `executions`, `errors`, `minMs`, `avgMs`, `p50Ms`, `p95Ms`, `p99Ms`, `maxMs`,
`throughputOpsPerSec` (= successful executions / step wall-clock time).

## Error handling

- A single execution failing does not abort the run — it's counted in `errors` and the
  step still reports metrics for its successful executions.
- The existing read/write/all query-mode setting (`normalizeQuery`'s `QueryMode`) is
  honored for every step, same as the CQL console — so a benchmark can't accidentally run
  destructive DML unless the user has switched to Write or All mode.
- If the connection drops mid-run, the run is marked failed/partial and whatever step
  results were already collected are kept and shown, not discarded.

## Testing

- Unit tests for `benchmark.ts`'s aggregation (percentile math, throughput calculation,
  error counting) as pure-function tests, matching the style of existing `query.ts` tests.
- An end-to-end test using the existing `docker-compose.e2e.yml` Cassandra fixture: define
  a small scenario, run it, and assert the shape/sanity of the resulting metrics.
- A unit test for the Markdown report generator given two fixed `BenchmarkRun` objects,
  asserting the delta percentages and summary line are computed correctly.
