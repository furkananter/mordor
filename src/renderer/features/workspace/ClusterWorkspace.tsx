import { lazy, Suspense, useState } from "react";
import { Play } from "lucide-react";
import { ProfileListItem, SchemaScriptResult } from "../../../core/ipc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../../components/ui/AlertDialog";
import { Button } from "../../components/ui/Button";
import { PanelHeader } from "../../components/ui/PanelHeader";
import { SegmentedControl, SegmentedOption } from "../../components/ui/SegmentedControl";
import { TabPanel } from "../../components/ui/TabPanel";
import { useConnectionStore } from "../../store/connection";
import { useLayoutStore } from "../../store/layout";
import { useStatusStore } from "../../store/status";
import { CqlPanel } from "./CqlPanel";

// MigrationsPage pulls in the migration history table + a heavy editor; it
// shouldn't ride along with every cluster workspace mount.
const MigrationsPage = lazy(() =>
  import("./migrations/MigrationsPage").then((m) => ({ default: m.MigrationsPage }))
);
const CqlEditor = lazy(() =>
  import("../../components/ui/cql-editor/CqlEditor").then((m) => ({ default: m.CqlEditor }))
);

export type ClusterTab = "cql" | "schema" | "migrations";

const TAB_OPTIONS: SegmentedOption<ClusterTab>[] = [
  { value: "cql", label: "CQL" },
  { value: "schema", label: "Schema" },
  { value: "migrations", label: "Migrations" }
];

export function ClusterWorkspace({
  profile,
  queryText,
  queryResult,
  queryLoading,
  onQueryChange,
  onRun,
  history = [],
}: {
  profile: ProfileListItem;
  queryText: string;
  queryResult: import("../../../core/shared/messages").QueryResultPayload | undefined;
  queryLoading: boolean;
  onQueryChange(value: string): void;
  onRun(): Promise<void>;
  history?: string[];
}) {
  const activeTab = useLayoutStore((state) => state.activeTab);
  const setActiveTab = useLayoutStore((state) => state.setActiveTab);
  const tab: ClusterTab =
    activeTab === "schema" ? "schema" : activeTab === "migrations" ? "migrations" : "cql";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
        <div className="border-b border-line-soft px-3">
          <SegmentedControl
            namespace="cluster-tabs"
            ariaLabel="Cluster tabs"
            value={tab}
            onChange={(next) => setActiveTab(next)}
            options={TAB_OPTIONS}
          />
        </div>
        <TabPanel active={tab === "cql"}>
          <CqlPanel
            queryText={queryText}
            queryResult={queryResult}
            loading={queryLoading}
            onChange={onQueryChange}
            onRun={onRun}
            placeholder={`-- Run CQL against ${profile.name}\nSELECT keyspace_name, table_name FROM system_schema.tables;`}
            history={history}
          />
        </TabPanel>
        <TabPanel active={tab === "migrations"}>
          <Suspense fallback={<div className="grid h-full place-items-center text-[11.5px] text-muted">Loading migrations…</div>}>
            <MigrationsPage embedded lockedProfileId={profile.id} />
          </Suspense>
        </TabPanel>
        <TabPanel active={tab === "schema"}>
          <ClusterSchemaPanel profile={profile} />
        </TabPanel>
      </section>
    </div>
  );
}

function ClusterSchemaPanel({ profile }: { profile: ProfileListItem }) {
  const setError = useStatusStore((state) => state.setError);
  const refreshClusterSchema = useConnectionStore((state) => state.refreshClusterSchema);
  const [ddl, setDdl] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SchemaScriptResult | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const runScript = async () => {
    if (!ddl.trim()) return;
    setRunning(true);
    setResult(undefined);
    setConfirmOpen(false);
    try {
      const next = await window.cassandraDesk.runSchemaScript(profile.id, ddl);
      setResult(next);
      // Even on partial success we should refresh — earlier statements may
      // have created/dropped tables that the sidebar tree must learn about.
      if (next.statementsExecuted > 0) await refreshClusterSchema(profile.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <PanelHeader
        title="Schema"
        meta={`${profile.name} · raw DDL`}
        actions={
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={running || !ddl.trim()}
            tooltip="Run the DDL against this cluster"
          >
            <Play size={11} strokeWidth={1.7} />
            <span>{running ? "Running…" : "Apply"}</span>
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-px">
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<div className="grid h-full place-items-center text-[11.5px] text-muted">Loading editor…</div>}>
            <CqlEditor
              value={ddl}
              onChange={setDdl}
              onRun={() => setConfirmOpen(true)}
              placeholder={"-- Cluster-wide DDL. Examples:\n-- CREATE KEYSPACE foo WITH replication = { 'class': 'SimpleStrategy', 'replication_factor': 1 };\n-- CREATE TABLE foo.bar (id uuid PRIMARY KEY, body text);\n-- ALTER TABLE foo.bar ADD created_at timestamp;"}
              ariaLabel="Cluster DDL editor"
            />
          </Suspense>
        </div>
        <ResultPanel result={result} />
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => (running ? null : setConfirmOpen(open))}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Run DDL on {profile.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Statements will be executed sequentially. Schema changes are not transactional in Cassandra — if a
              statement fails the previous ones stay applied. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={running}
              onClick={(event) => {
                event.preventDefault();
                void runScript();
              }}
            >
              {running ? "Running…" : "Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ResultPanel({ result }: { result: SchemaScriptResult | undefined }) {
  if (!result) return null;
  const ok = !result.error;
  return (
    <div className="max-h-[200px] overflow-y-auto border-t border-line-soft bg-panel-soft px-3 py-2 font-mono text-[11.5px]">
      <div className={`flex items-center gap-2 ${ok ? "text-success" : "text-danger"}`}>
        <span>{ok ? "✓" : "✗"}</span>
        <span>
          {result.statementsExecuted}/{result.totalStatements} statements · {result.durationMs}ms
          {result.schemaAgreementOk ? "" : " · schema agreement timed out"}
        </span>
      </div>
      {result.error ? <pre className="mt-1 whitespace-pre-wrap text-danger">{result.error}</pre> : null}
      {result.statements.map((statement) => (
        <div key={statement.index} className="mt-1 border-t border-line-soft/60 pt-1 last:border-b-0">
          <div className={`flex items-center justify-between gap-2 ${statement.ok ? "text-muted" : "text-danger"}`}>
            <span>
              {statement.ok ? "✓" : "✗"} Statement {statement.index} · {statement.durationMs}ms
            </span>
          </div>
          <pre className="mt-0.5 whitespace-pre-wrap break-all text-text/80">{statement.cql}</pre>
          {statement.error ? <pre className="whitespace-pre-wrap text-danger">{statement.error}</pre> : null}
        </div>
      ))}
    </div>
  );
}
