import {
  BenchmarkRunOutcome,
  BenchmarkStepResult,
  deriveBenchmarkRunOutcome,
} from "./benchmark";
import { QueryMode } from "./query";

export type { BenchmarkRunOutcome } from "./benchmark";
export type BenchmarkComparisonStatus = "verified" | "unverified" | "incompatible";
export type BenchmarkStepKind = "matched" | "changed_workload" | "added" | "removed";
export type BenchmarkStepVerdict = "faster" | "regressed" | "unchanged" | "unverified";

export interface BenchmarkReportRun {
  label: string;
  ranAt: number;
  steps: BenchmarkStepResult[];
  /** Optional for legacy report callers and persisted runs. */
  profileId?: string;
  /** Optional because older persisted runs did not snapshot query mode. */
  queryMode?: QueryMode;
  /** Optional because older persisted runs did not snapshot the derived outcome. */
  outcome?: BenchmarkRunOutcome;
}

export interface BenchmarkComparisonInput {
  scenarioName: string;
  before: BenchmarkReportRun;
  after: BenchmarkReportRun;
}

export interface BenchmarkComparisonEligibility {
  status: BenchmarkComparisonStatus;
  reasons: string[];
}

export interface BenchmarkStepComparison {
  stepId: string;
  before?: BenchmarkStepResult;
  after?: BenchmarkStepResult;
  kind: BenchmarkStepKind;
  verdict: BenchmarkStepVerdict;
  avgDeltaPercent: number | null;
  reasons: string[];
}

export interface BenchmarkComparison {
  beforeOutcome: BenchmarkRunOutcome;
  afterOutcome: BenchmarkRunOutcome;
  eligibility: BenchmarkComparisonEligibility;
  steps: BenchmarkStepComparison[];
  fasterCount: number;
  regressedCount: number;
  comparableCount: number;
  worstRegressionPct: number;
}

/** `before` -> `after` percentage change; `null` when `before` is 0 (undefined baseline). */
export function deltaPercent(before: number, after: number): number | null {
  if (before === 0) return after === 0 ? 0 : null;
  return ((after - before) / before) * 100;
}

/** Number of successful operations represented by a step's latency metrics. */
export function successfulExecutions(step: BenchmarkStepResult): number {
  const inferred = step.successfulExecutions ?? step.executions - step.errors;
  return Math.max(0, Math.min(step.executions, inferred));
}

export { deriveBenchmarkRunOutcome } from "./benchmark";

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function isQueryMode(value: QueryMode | undefined): value is QueryMode {
  return value === "read" || value === "write" || value === "all";
}

function compareGlobalEligibility(
  before: BenchmarkReportRun,
  after: BenchmarkReportRun,
  beforeOutcome: BenchmarkRunOutcome,
  afterOutcome: BenchmarkRunOutcome,
  pairedSteps: Array<{ before: BenchmarkStepResult; after: BenchmarkStepResult }>,
  addedStepIds: string[],
  removedStepIds: string[],
): BenchmarkComparisonEligibility {
  const reasons: string[] = [];
  let hasIncompatibility = false;
  const hasInvalidBeforeStep = before.steps.some(
    (step) => step.errors > 0 || successfulExecutions(step) === 0,
  );
  const hasInvalidAfterStep = after.steps.some(
    (step) => step.errors > 0 || successfulExecutions(step) === 0,
  );

  if (before.profileId === undefined || after.profileId === undefined) {
    addReason(reasons, "Profile metadata is missing from one or both runs.");
  } else if (before.profileId !== after.profileId) {
    addReason(reasons, `Runs use different profiles (${before.profileId} vs ${after.profileId}).`);
    hasIncompatibility = true;
  }

  if (!isQueryMode(before.queryMode) || !isQueryMode(after.queryMode)) {
    addReason(reasons, "Query mode metadata is missing from one or both runs.");
  } else if (before.queryMode !== after.queryMode) {
    addReason(reasons, `Runs use different query modes (${before.queryMode} vs ${after.queryMode}).`);
    hasIncompatibility = true;
  }

  for (const pair of pairedSteps) {
    if (pair.before.repeat === undefined || pair.after.repeat === undefined) {
      addReason(reasons, `Repeat metadata is missing for step ${pair.before.stepId}.`);
    } else if (pair.before.repeat !== pair.after.repeat) {
      addReason(
        reasons,
        `Step ${pair.before.stepId} uses different repeat counts (${pair.before.repeat} vs ${pair.after.repeat}).`,
      );
      hasIncompatibility = true;
    }

    if (pair.before.concurrency === undefined || pair.after.concurrency === undefined) {
      addReason(reasons, `Concurrency metadata is missing for step ${pair.before.stepId}.`);
    } else if (pair.before.concurrency !== pair.after.concurrency) {
      addReason(
        reasons,
        `Step ${pair.before.stepId} uses different concurrency (${pair.before.concurrency} vs ${pair.after.concurrency}).`,
      );
      hasIncompatibility = true;
    }

    if (pair.before.cql !== pair.after.cql) {
      addReason(reasons, `Step ${pair.before.stepId} has changed CQL and is a changed workload.`);
    }

    if (pair.before.errors > 0 || pair.after.errors > 0) {
      addReason(reasons, `Step ${pair.before.stepId} has execution errors.`);
    }
    if (successfulExecutions(pair.before) === 0 || successfulExecutions(pair.after) === 0) {
      addReason(reasons, `Step ${pair.before.stepId} has no successful executions in one or both runs.`);
    }
  }

  for (const stepId of removedStepIds) addReason(reasons, `Step ${stepId} is present only in the before run.`);
  for (const stepId of addedStepIds) addReason(reasons, `Step ${stepId} is present only in the after run.`);

  if (hasInvalidBeforeStep) addReason(reasons, "The before run contains a step with errors or zero successful executions.");
  if (hasInvalidAfterStep) addReason(reasons, "The after run contains a step with errors or zero successful executions.");

  if (beforeOutcome === "failed") addReason(reasons, "The before run failed.");
  if (afterOutcome === "failed") addReason(reasons, "The after run failed.");

  return {
    status: hasIncompatibility ? "incompatible" : reasons.length > 0 ? "unverified" : "verified",
    reasons,
  };
}

/**
 * Matches steps by stable step ID and classifies whether latency deltas are
 * valid to describe as faster or regressed. The same result drives both the
 * renderer table and the exported Markdown report.
 */
export function compareBenchmarkRuns(input: BenchmarkComparisonInput): BenchmarkComparison {
  const { before, after } = input;
  const beforeOutcome = before.outcome ?? deriveBenchmarkRunOutcome(before);
  const afterOutcome = after.outcome ?? deriveBenchmarkRunOutcome(after);
  const afterById = new Map(after.steps.map((step) => [step.stepId, step]));
  const matchedAfterIds = new Set<string>();
  const comparisons: BenchmarkStepComparison[] = [];
  const pairedSteps: Array<{ before: BenchmarkStepResult; after: BenchmarkStepResult }> = [];
  const removedStepIds: string[] = [];

  for (const beforeStep of before.steps) {
    const afterStep = afterById.get(beforeStep.stepId);
    if (!afterStep) {
      removedStepIds.push(beforeStep.stepId);
      comparisons.push({
        stepId: beforeStep.stepId,
        before: beforeStep,
        kind: "removed",
        verdict: "unverified",
        avgDeltaPercent: null,
        reasons: ["Step is present only in the before run."],
      });
      continue;
    }

    matchedAfterIds.add(afterStep.stepId);
    pairedSteps.push({ before: beforeStep, after: afterStep });
  }

  const addedStepIds = after.steps.filter((step) => !matchedAfterIds.has(step.stepId)).map((step) => step.stepId);
  const eligibility = compareGlobalEligibility(
    before,
    after,
    beforeOutcome,
    afterOutcome,
    pairedSteps,
    addedStepIds,
    removedStepIds,
  );

  const hasMissingGlobalMetadata =
    before.profileId === undefined ||
    after.profileId === undefined ||
    !isQueryMode(before.queryMode) ||
    !isQueryMode(after.queryMode);
  const hasMismatchedGlobalMetadata =
    (before.profileId !== undefined && after.profileId !== undefined && before.profileId !== after.profileId) ||
    (isQueryMode(before.queryMode) && isQueryMode(after.queryMode) && before.queryMode !== after.queryMode);
  const hasInvalidGlobalStep = before.steps.some(
    (step) => step.errors > 0 || successfulExecutions(step) === 0,
  ) || after.steps.some((step) => step.errors > 0 || successfulExecutions(step) === 0);

  for (const beforeStep of before.steps) {
    const afterStep = afterById.get(beforeStep.stepId);
    if (!afterStep) continue;

    const reasons: string[] = [];
    const cqlChanged = beforeStep.cql !== afterStep.cql;
    if (cqlChanged) addReason(reasons, "CQL changed; metrics are retained for reference but are not equivalent workload results.");
    if (hasMissingGlobalMetadata) addReason(reasons, "Run metadata is incomplete.");
    if (hasMismatchedGlobalMetadata) addReason(reasons, "Run metadata is incompatible.");
    if (hasInvalidGlobalStep) addReason(reasons, "One or both runs contain an invalid step; performance verdicts are suppressed.");
    if (beforeStep.repeat === undefined || afterStep.repeat === undefined) {
      addReason(reasons, "Repeat setting is unknown for one or both runs.");
    } else if (beforeStep.repeat !== afterStep.repeat) {
      addReason(reasons, "Repeat setting changed between runs.");
    }
    if (beforeStep.concurrency === undefined || afterStep.concurrency === undefined) {
      addReason(reasons, "Concurrency setting is unknown for one or both runs.");
    } else if (beforeStep.concurrency !== afterStep.concurrency) {
      addReason(reasons, "Concurrency setting changed between runs.");
    }
    if (beforeStep.errors > 0 || afterStep.errors > 0) addReason(reasons, "One or both runs have execution errors.");
    if (successfulExecutions(beforeStep) === 0 || successfulExecutions(afterStep) === 0) {
      addReason(reasons, "One or both runs have zero successful executions.");
    }

    const avgDeltaPercent = deltaPercent(beforeStep.avgMs, afterStep.avgMs);
    if (avgDeltaPercent === null) addReason(reasons, "Average latency baseline is zero.");
    const canClassify = reasons.length === 0;
    let verdict: BenchmarkStepVerdict = "unverified";
    if (canClassify && avgDeltaPercent !== null) {
      verdict = avgDeltaPercent < 0 ? "faster" : avgDeltaPercent > 0 ? "regressed" : "unchanged";
    }
    comparisons.push({
      stepId: beforeStep.stepId,
      before: beforeStep,
      after: afterStep,
      kind: cqlChanged ? "changed_workload" : "matched",
      verdict,
      avgDeltaPercent,
      reasons,
    });
  }

  for (const afterStep of after.steps) {
    if (matchedAfterIds.has(afterStep.stepId)) continue;
    comparisons.push({
      stepId: afterStep.stepId,
      after: afterStep,
      kind: "added",
      verdict: "unverified",
      avgDeltaPercent: null,
      reasons: ["Step is present only in the after run."],
    });
  }

  const fasterCount = comparisons.filter((comparison) => comparison.verdict === "faster").length;
  const regressedCount = comparisons.filter((comparison) => comparison.verdict === "regressed").length;
  const comparableCount = comparisons.filter((comparison) => comparison.verdict !== "unverified").length;
  const worstRegressionPct = comparisons.reduce(
    (worst, comparison) =>
      comparison.verdict === "regressed" && comparison.avgDeltaPercent !== null
        ? Math.max(worst, comparison.avgDeltaPercent)
        : worst,
    0,
  );

  return {
    beforeOutcome,
    afterOutcome,
    eligibility,
    steps: comparisons,
    fasterCount,
    regressedCount,
    comparableCount,
    worstRegressionPct,
  };
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

function formatCql(cql: string): string {
  return `\`${cql}\``;
}

function formatRunOutcome(outcome: BenchmarkRunOutcome): string {
  return outcome.replaceAll("_", " ");
}

function formatMetricDelta(comparison: BenchmarkStepComparison, before: number, after: number): string {
  const suffix = comparison.verdict === "unverified"
    ? " (unverified)"
    : comparison.kind === "changed_workload"
      ? " (changed workload)"
      : "";
  return `${formatDelta(before, after)}${suffix}`;
}

/**
 * Renders a plain-Markdown before/after report for a benchmark scenario,
 * meant to be handed directly to an AI assistant (or read by a human) — no
 * code fences, just a title, a metrics table per step, and a one-line
 * summary judgment.
 */
export function buildBenchmarkComparisonMarkdown(input: BenchmarkComparisonInput): string {
  const { scenarioName, before, after } = input;
  const comparison = compareBenchmarkRuns(input);
  const lines: string[] = [];

  lines.push(`# Benchmark Comparison — ${scenarioName}`, "");
  lines.push(`**Before:** ${before.label} (${new Date(before.ranAt).toISOString()})`);
  lines.push(`**After:** ${after.label} (${new Date(after.ranAt).toISOString()})`);
  lines.push(`**Before outcome:** ${formatRunOutcome(comparison.beforeOutcome)}`);
  lines.push(`**After outcome:** ${formatRunOutcome(comparison.afterOutcome)}`);
  lines.push(`**Comparison status:** ${comparison.eligibility.status}`);
  if (comparison.eligibility.reasons.length > 0) {
    lines.push(`**Comparison notes:** ${comparison.eligibility.reasons.join(" ")}`);
  }
  lines.push("");
  lines.push("| Step | CQL | Metric | Before | After | Delta |");
  lines.push("|---|---|---|---|---|---|");

  for (let i = 0; i < comparison.steps.length; i += 1) {
    const stepComparison = comparison.steps[i]!;
    const label = `${i + 1}`;
    const beforeStep = stepComparison.before;
    const afterStep = stepComparison.after;
    if (!beforeStep || !afterStep) {
      const cql = (afterStep ?? beforeStep)?.cql ?? "";
      lines.push(`| ${label} | ${formatCql(cql)} | — | — | — | no matching run |`);
      continue;
    }

    const cql = stepComparison.kind === "changed_workload"
      ? `before: ${formatCql(beforeStep.cql)}<br>after: ${formatCql(afterStep.cql)}`
      : formatCql(afterStep.cql);
    lines.push(`| ${label} | ${cql} | avg ms | ${formatMs(beforeStep.avgMs)} | ${formatMs(afterStep.avgMs)} | ${formatMetricDelta(stepComparison, beforeStep.avgMs, afterStep.avgMs)} |`);
    lines.push(`| ${label} | | p95 ms | ${formatMs(beforeStep.p95Ms)} | ${formatMs(afterStep.p95Ms)} | ${formatMetricDelta(stepComparison, beforeStep.p95Ms, afterStep.p95Ms)} |`);
    lines.push(`| ${label} | | p99 ms | ${formatMs(beforeStep.p99Ms)} | ${formatMs(afterStep.p99Ms)} | ${formatMetricDelta(stepComparison, beforeStep.p99Ms, afterStep.p99Ms)} |`);
    lines.push(
      `| ${label} | | throughput ops/s | ${beforeStep.throughputOpsPerSec.toFixed(1)} | ${afterStep.throughputOpsPerSec.toFixed(1)} | ${formatMetricDelta(stepComparison, beforeStep.throughputOpsPerSec, afterStep.throughputOpsPerSec)} |`,
    );
    const errorDelta = afterStep.errors - beforeStep.errors;
    lines.push(`| ${label} | | errors | ${beforeStep.errors} | ${afterStep.errors} | ${errorDelta === 0 ? "—" : (errorDelta > 0 ? "+" : "") + errorDelta} |`);
  }

  lines.push("", "## Summary");
  if (comparison.comparableCount === 0) {
    lines.push("No verified comparable steps between the two runs.");
  } else {
    const regressionNote = comparison.regressedCount > 0
      ? ` (worst: +${comparison.worstRegressionPct.toFixed(1)}% avg latency)`
      : "";
    lines.push(
      `${comparison.fasterCount} of ${comparison.comparableCount} step(s) got faster by average latency; ${comparison.regressedCount} regressed${regressionNote}.`,
    );
  }
  if (comparison.eligibility.status !== "verified") {
    lines.push("Performance verdicts are suppressed for unverified or incompatible run data.");
  }

  return lines.join("\n");
}
