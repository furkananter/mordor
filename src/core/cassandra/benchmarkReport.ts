import { BenchmarkStepResult } from "./benchmark";

export interface BenchmarkReportRun {
  label: string;
  ranAt: number;
  steps: BenchmarkStepResult[];
}

export interface BenchmarkComparisonInput {
  scenarioName: string;
  before: BenchmarkReportRun;
  after: BenchmarkReportRun;
}

/** `before` -> `after` percentage change; `null` when `before` is 0 (undefined baseline). */
export function deltaPercent(before: number, after: number): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return ((after - before) / before) * 100;
}

function formatDelta(before: number, after: number): string {
  const delta = deltaPercent(before, after);
  if (delta === null) return "n/a";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function formatMs(value: number): string {
  return value.toFixed(1);
}

/**
 * Renders a plain-Markdown before/after report for a benchmark scenario,
 * meant to be handed directly to an AI assistant (or read by a human) — no
 * code fences, just a title, a metrics table per step, and a one-line
 * summary judgment.
 */
export function buildBenchmarkComparisonMarkdown(input: BenchmarkComparisonInput): string {
  const { scenarioName, before, after } = input;
  const lines: string[] = [];

  lines.push(`# Benchmark Comparison — ${scenarioName}`, "");
  lines.push(`**Before:** ${before.label} (${new Date(before.ranAt).toISOString()})`);
  lines.push(`**After:** ${after.label} (${new Date(after.ranAt).toISOString()})`, "");
  lines.push("| Step | CQL | Metric | Before | After | Delta |");
  lines.push("|---|---|---|---|---|---|");

  const stepCount = Math.max(before.steps.length, after.steps.length);
  let fasterCount = 0;
  let regressedCount = 0;
  let worstRegressionPct = 0;

  for (let i = 0; i < stepCount; i += 1) {
    const b = before.steps[i];
    const a = after.steps[i];
    const label = `${i + 1}`;
    if (!b || !a) {
      const cql = (a ?? b)?.cql ?? "";
      lines.push(`| ${label} | \`${cql}\` | — | — | — | no matching run |`);
      continue;
    }

    const avgDelta = deltaPercent(b.avgMs, a.avgMs);
    if (avgDelta !== null) {
      if (avgDelta < 0) fasterCount += 1;
      else if (avgDelta > 0) {
        regressedCount += 1;
        worstRegressionPct = Math.max(worstRegressionPct, avgDelta);
      }
    }

    const errorDelta = a.errors - b.errors;
    lines.push(`| ${label} | \`${a.cql}\` | avg ms | ${formatMs(b.avgMs)} | ${formatMs(a.avgMs)} | ${formatDelta(b.avgMs, a.avgMs)} |`);
    lines.push(`| ${label} | | p95 ms | ${formatMs(b.p95Ms)} | ${formatMs(a.p95Ms)} | ${formatDelta(b.p95Ms, a.p95Ms)} |`);
    lines.push(`| ${label} | | p99 ms | ${formatMs(b.p99Ms)} | ${formatMs(a.p99Ms)} | ${formatDelta(b.p99Ms, a.p99Ms)} |`);
    lines.push(
      `| ${label} | | throughput ops/s | ${b.throughputOpsPerSec.toFixed(1)} | ${a.throughputOpsPerSec.toFixed(1)} | ${formatDelta(b.throughputOpsPerSec, a.throughputOpsPerSec)} |`,
    );
    lines.push(`| ${label} | | errors | ${b.errors} | ${a.errors} | ${errorDelta === 0 ? "—" : (errorDelta > 0 ? "+" : "") + errorDelta} |`);
  }

  lines.push("", "## Summary");
  const compared = fasterCount + regressedCount;
  if (compared === 0) {
    lines.push("No comparable steps between the two runs.");
  } else {
    const regressionNote = regressedCount > 0 ? ` (worst: +${worstRegressionPct.toFixed(1)}% avg latency)` : "";
    lines.push(
      `${fasterCount} of ${compared} step(s) got faster by average latency; ${regressedCount} regressed${regressionNote}.`,
    );
  }

  return lines.join("\n");
}
