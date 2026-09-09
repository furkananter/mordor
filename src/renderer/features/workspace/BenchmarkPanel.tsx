import { useMemo, useState } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import { BenchmarkRunResult } from "../../../core/cassandra/benchmark";
import { ProfileListItem } from "../../../core/ipc";
import { Button } from "../../components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import { Input } from "../../components/ui/Input";
import { PanelHeader } from "../../components/ui/PanelHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/Select";
import { usePreferencesStore } from "../../store/preferences";
import { BenchmarkRun, BenchmarkScenario, BenchmarkStep, resolveScenarioSteps, useBenchmarkStore } from "../../store/benchmark";
import { useQueryHistoryStore } from "../../store/queryHistory";
import { useStatusStore } from "../../store/status";

export function BenchmarkPanel({ profile }: { profile: ProfileListItem }) {
  const scenarios = useBenchmarkStore((state) => state.scenarios);
  const createScenario = useBenchmarkStore((state) => state.createScenario);
  const renameScenario = useBenchmarkStore((state) => state.renameScenario);
  const deleteScenario = useBenchmarkStore((state) => state.deleteScenario);

  const allRuns = useBenchmarkStore((state) => state.runs);

  const ownScenarios = useMemo(
    () => scenarios.filter((scenario) => scenario.profileId === undefined || scenario.profileId === profile.id),
    [scenarios, profile.id],
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(ownScenarios[0]?.id);
  const selected = ownScenarios.find((scenario) => scenario.id === selectedId);

  const handleCreate = () => {
    const scenario = createScenario(`Scenario ${ownScenarios.length + 1}`, profile.id);
    setSelectedId(scenario.id);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <PanelHeader
        title="Benchmark"
        meta={profile.name}
        actions={
          <div className="flex items-center gap-2">
            <ScenarioPicker scenarios={ownScenarios} selectedId={selectedId} onSelect={setSelectedId} />
            <Button variant="ghost" onClick={handleCreate} tooltip="New scenario">
              <Plus size={12} strokeWidth={1.7} />
              <span>New scenario</span>
            </Button>
          </div>
        }
      />
      {selected ? (
        <ScenarioEditor
          key={selected.id}
          scenario={selected}
          profile={profile}
          runs={allRuns.filter((run) => run.scenarioId === selected.id)}
          onRename={(name) => renameScenario(selected.id, name)}
          onDelete={() => {
            deleteScenario(selected.id);
            setSelectedId(ownScenarios.find((scenario) => scenario.id !== selected.id)?.id);
          }}
        />
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center text-[11.5px] text-muted">
          Create a scenario to define the queries you want to benchmark.
        </div>
      )}
    </section>
  );
}

function ScenarioPicker({
  scenarios,
  selectedId,
  onSelect,
}: {
  scenarios: BenchmarkScenario[];
  selectedId: string | undefined;
  onSelect(id: string): void;
}) {
  const selected = scenarios.find((scenario) => scenario.id === selectedId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">{selected ? selected.name : "Select scenario"}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {scenarios.length === 0 ? (
          <div className="px-2 py-2 text-[11.5px] text-muted">No scenarios yet.</div>
        ) : (
          scenarios.map((scenario) => (
            <DropdownMenuItem key={scenario.id} onSelect={() => onSelect(scenario.id)}>
              {scenario.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScenarioEditor({
  scenario,
  profile,
  runs,
  onRename,
  onDelete,
}: {
  scenario: BenchmarkScenario;
  profile: ProfileListItem;
  runs: BenchmarkRun[];
  onRename(name: string): void;
  onDelete(): void;
}) {
  const addStep = useBenchmarkStore((state) => state.addStep);
  const updateStep = useBenchmarkStore((state) => state.updateStep);
  const removeStep = useBenchmarkStore((state) => state.removeStep);
  const savedQueries = useQueryHistoryStore((state) => state.saved);
  const ownSavedQueries = useMemo(
    () => savedQueries.filter((query) => query.profileId === undefined || query.profileId === profile.id),
    [savedQueries, profile.id],
  );
  const [name, setName] = useState(scenario.name);

  const handleAddStep = (source: "saved" | "adhoc") => {
    const firstSavedQueryId = ownSavedQueries[0]?.id;
    addStep(scenario.id, {
      source,
      repeat: 100,
      concurrency: 10,
      ...(source === "saved"
        ? firstSavedQueryId === undefined
          ? {}
          : { savedQueryId: firstSavedQueryId }
        : { cql: "" }),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="flex items-center gap-2 border-b border-line-soft pb-3">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && onRename(name.trim())}
          aria-label="Scenario name"
          className="max-w-xs"
        />
        <Button variant="ghost" onClick={onDelete} tooltip="Delete scenario">
          <Trash2 size={12} strokeWidth={1.7} />
        </Button>
      </div>

      <div className="mt-3 grid gap-2">
        {scenario.steps.length === 0 ? (
          <p className="text-[11.5px] text-muted">
            No steps yet. Add a step from a saved query or write ad-hoc CQL.
          </p>
        ) : (
          scenario.steps.map((step, index) => (
            <StepRow
              key={step.id}
              index={index}
              step={step}
              savedQueries={ownSavedQueries}
              onChange={(patch) => updateStep(scenario.id, step.id, patch)}
              onRemove={() => removeStep(scenario.id, step.id)}
            />
          ))
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="ghost" onClick={() => handleAddStep("saved")}>
          <Plus size={12} strokeWidth={1.7} />
          Add saved query step
        </Button>
        <Button variant="ghost" onClick={() => handleAddStep("adhoc")}>
          <Plus size={12} strokeWidth={1.7} />
          Add ad-hoc CQL step
        </Button>
      </div>

      <RunControls scenario={scenario} profile={profile} runs={runs} />
    </div>
  );
}

function StepRow({
  index,
  step,
  savedQueries,
  onChange,
  onRemove,
}: {
  index: number;
  step: BenchmarkStep;
  savedQueries: Array<{ id: string; name: string; sql: string }>;
  onChange(patch: Partial<Pick<BenchmarkStep, "savedQueryId" | "cql" | "repeat" | "concurrency">>): void;
  onRemove(): void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-line-soft p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">
          Step {index + 1} · {step.source === "saved" ? "Saved query" : "Ad-hoc CQL"}
        </span>
        <button
          type="button"
          aria-label={`Remove step ${index + 1}`}
          className="text-subtle transition-colors hover:text-danger"
          onClick={onRemove}
        >
          <Trash2 size={12} strokeWidth={1.7} />
        </button>
      </div>

      {step.source === "saved" ? (
        savedQueries.length === 0 ? (
          <p className="text-[11.5px] text-muted">No saved queries for this connection yet.</p>
        ) : (
          <Select value={step.savedQueryId ?? ""} onValueChange={(value) => onChange({ savedQueryId: value })}>
            <SelectTrigger aria-label={`Saved query for step ${index + 1}`}>
              <SelectValue placeholder="Select a saved query..." />
            </SelectTrigger>
            <SelectContent>
              {savedQueries.map((query) => (
                <SelectItem key={query.id} value={query.id}>
                  {query.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : (
        <textarea
          aria-label={`CQL for step ${index + 1}`}
          className="min-h-[60px] rounded-md border border-line-soft bg-panel px-2 py-1 font-mono text-[12px] text-text"
          value={step.cql ?? ""}
          onChange={(event) => onChange({ cql: event.target.value })}
          placeholder="SELECT * FROM app.users WHERE id = ?"
        />
      )}

      <div className="flex items-center gap-3 text-[11.5px] text-muted">
        <label className="flex items-center gap-1.5">
          Repeat
          <Input
            type="number"
            min={1}
            value={step.repeat}
            onChange={(event) => onChange({ repeat: Math.max(1, Number(event.target.value) || 1) })}
            className="w-20"
            aria-label={`Repeat count for step ${index + 1}`}
          />
        </label>
        <label className="flex items-center gap-1.5">
          Concurrency
          <Input
            type="number"
            min={1}
            value={step.concurrency}
            onChange={(event) => onChange({ concurrency: Math.max(1, Number(event.target.value) || 1) })}
            className="w-20"
            aria-label={`Concurrency for step ${index + 1}`}
          />
        </label>
      </div>
    </div>
  );
}

function RunControls({
  scenario,
  profile,
  runs,
}: {
  scenario: BenchmarkScenario;
  profile: ProfileListItem;
  runs: BenchmarkRun[];
}) {
  const savedQueries = useQueryHistoryStore((state) => state.saved);
  const queryMode = usePreferencesStore((state) => state.queryMode);
  const recordRun = useBenchmarkStore((state) => state.recordRun);
  const deleteRun = useBenchmarkStore((state) => state.deleteRun);
  const setError = useStatusStore((state) => state.setError);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number } | undefined>(undefined);
  const [pendingResult, setPendingResult] = useState<BenchmarkRunResult | undefined>(undefined);
  const [label, setLabel] = useState("");

  const handleRun = async () => {
    const resolved = resolveScenarioSteps(scenario, savedQueries);
    const errorStep = resolved.find((step) => step.error);
    if (errorStep) {
      setError(errorStep.error!);
      return;
    }
    if (resolved.length === 0) {
      setError("Add at least one step before running the scenario.");
      return;
    }

    setRunning(true);
    setPendingResult(undefined);
    setProgress({ index: 0, total: resolved.length });
    const unsubscribe = window.cassandraDesk.onBenchmarkProgress((next) =>
      setProgress({ index: next.index, total: next.total }),
    );
    try {
      const result = await window.cassandraDesk.runBenchmark(
        profile.id,
        resolved.map(({ error, ...step }) => {
          void error;
          return step as { stepId: string; cql: string; repeat: number; concurrency: number };
        }),
        queryMode,
      );
      setPendingResult(result);
      setLabel("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      unsubscribe();
      setRunning(false);
      setProgress(undefined);
    }
  };

  const handleSaveRun = () => {
    if (!pendingResult) return;
    recordRun({
      scenarioId: scenario.id,
      profileId: profile.id,
      ranAt: Date.now(),
      totalDurationMs: pendingResult.totalDurationMs,
      steps: pendingResult.steps,
      ...(label.trim() ? { label: label.trim() } : {}),
    });
    setPendingResult(undefined);
  };

  return (
    <div className="mt-4 border-t border-line-soft pt-3">
      <Button variant="primary" onClick={() => void handleRun()} disabled={running}>
        <Play size={12} strokeWidth={1.7} />
        {running ? `Running${progress ? ` ${progress.index}/${progress.total}` : "…"}` : "Run scenario"}
      </Button>

      {pendingResult ? (
        <div className="mt-3 grid gap-2 rounded-md border border-line-soft p-2">
          <p className="text-[11.5px] text-muted">
            Run finished in {pendingResult.totalDurationMs}ms. Give it a label (e.g. &quot;baseline — old
            schema&quot;) and save it to compare later.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Label (optional)"
              aria-label="Run label"
              className="max-w-xs"
            />
            <Button variant="primary" onClick={handleSaveRun}>
              Save run
            </Button>
          </div>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">Run history</h3>
          <ul className="mt-1 grid gap-1">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line-soft px-2 py-1.5 text-[11.5px]"
              >
                <span className="text-text">
                  {run.label ?? "Unlabeled run"}{" "}
                  <span className="text-subtle">· {new Date(run.ranAt).toLocaleString()}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Delete run ${run.label ?? run.id}`}
                  className="text-subtle transition-colors hover:text-danger"
                  onClick={() => deleteRun(run.id)}
                >
                  <Trash2 size={12} strokeWidth={1.7} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
