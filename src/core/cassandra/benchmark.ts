/**
 * Executes a Cassandra benchmark scenario: an ordered list of CQL steps, each
 * repeated `repeat` times across `concurrency` parallel workers against an
 * already-connected client. Steps run one after another so their timings
 * don't interfere with each other; executions within a single step run
 * concurrently.
 *
 * This module has no Electron/IPC/driver dependency — the caller supplies an
 * `execute` function (CassandraService wires it to `client.execute`), which
 * keeps the concurrency/aggregation logic unit-testable without a real
 * cluster (see test/benchmark.test.ts).
 */

export interface ResolvedBenchmarkStep {
  stepId: string;
  cql: string;
  repeat: number;
  concurrency: number;
}

export interface BenchmarkStepResult {
  stepId: string;
  cql: string;
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

export interface BenchmarkRunResult {
  totalDurationMs: number;
  steps: BenchmarkStepResult[];
}

/** Nearest-rank percentile over an already-sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

export function computeStepMetrics(
  stepId: string,
  cql: string,
  durationsMs: number[],
  errors: number,
  wallMs: number,
): BenchmarkStepResult {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    stepId,
    cql,
    executions: sorted.length + errors,
    errors,
    minMs: sorted[0] ?? 0,
    avgMs: sorted.length > 0 ? sum / sorted.length : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1] ?? 0,
    throughputOpsPerSec: wallMs > 0 ? (sorted.length / wallMs) * 1000 : 0,
  };
}

/**
 * Runs `repeat` executions of `cql` distributed across `concurrency` parallel
 * workers. A single execution failing is counted in `errors` and does not
 * stop the others — the same "one bad statement doesn't wreck the run"
 * expectation the CQL console already has for scripts, applied per
 * execution instead of per statement.
 */
async function runStepExecutions(
  execute: (cql: string) => Promise<void>,
  cql: string,
  repeat: number,
  concurrency: number,
): Promise<{ durationsMs: number[]; errors: number }> {
  const durationsMs: number[] = [];
  let errors = 0;
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, repeat));

  async function worker(): Promise<void> {
    while (next < repeat) {
      next += 1;
      const started = Date.now();
      try {
        await execute(cql);
        durationsMs.push(Date.now() - started);
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return { durationsMs, errors };
}

export async function executeBenchmarkSteps(
  execute: (cql: string) => Promise<void>,
  steps: ResolvedBenchmarkStep[],
  onStep?: (result: BenchmarkStepResult) => void,
): Promise<BenchmarkRunResult> {
  const started = Date.now();
  const results: BenchmarkStepResult[] = [];

  for (const step of steps) {
    const stepStarted = Date.now();
    const { durationsMs, errors } = await runStepExecutions(
      execute,
      step.cql,
      step.repeat,
      step.concurrency,
    );
    const result = computeStepMetrics(step.stepId, step.cql, durationsMs, errors, Date.now() - stepStarted);
    results.push(result);
    onStep?.(result);
  }

  return { totalDurationMs: Date.now() - started, steps: results };
}
