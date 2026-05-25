import { lazy, Suspense, useState } from "react";
import { Play } from "lucide-react";
import { PostgresProfileListItem, SchemaScriptResult } from "../../../../core/ipc";
import { QueryResultPayload } from "../../../../core/shared/messages";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/AlertDialog";
import { Button } from "../../../components/ui/Button";
import { PanelHeader } from "../../../components/ui/PanelHeader";
import { SegmentedControl, SegmentedOption } from "../../../components/ui/SegmentedControl";
import { useConnectionStore } from "../../../store/connection";
import { useLayoutStore } from "../../../store/layout";
import { useStatusStore } from "../../../store/status";
import { CqlPanel } from "../CqlPanel";

// Reuse the Cassandra cluster's persisted tab key so switching profiles
// preserves the user's "I was on Schema" intent across DB types.
type PostgresTab = "cql" | "schema";

const TAB_OPTIONS: SegmentedOption<PostgresTab>[] = [
  { value: "cql", label: "SQL" },
  { value: "schema", label: "Schema" },
];

// CqlEditor is the heavy CodeMirror chunk; lazy-load so the SQL Console tab
// keeps its first paint fast and the Schema tab only pays the cost when opened.
const CqlEditor = lazy(() =>
  import("../../../components/ui/cql-editor/CqlEditor").then((m) => ({ default: m.CqlEditor })),
);

/**
 * Cluster-level workspace for a connected Postgres profile. Two tabs:
 * - SQL: ad-hoc query console (CqlPanel under the hood — engine-agnostic).
 * - Schema: raw DDL editor wrapped in a transaction. Unlike Cassandra, pg's
 *   transactional DDL means a mid-script failure rolls back cleanly — we
 *   highlight that in the confirm dialog so the user understands the
 *   safety guarantee.
 */
export function PostgresWorkspace({
  profile,
  queryText,
  queryResult,
  queryLoading,
  onQueryChange,
  onRun,
}: {
  profile: PostgresProfileListItem;
  queryText: string;
  queryResult: QueryResultPayload | undefined;
  queryLoading: boolean;
  onQueryChange(value: string): void;
  onRun(): Promise<void>;
}) {
  const activeTab = useLayoutStore((state) => state.activeTab);
  const setActiveTab = useLayoutStore((state) => state.setActiveTab);
  // Fold non-pg tab keys (data, migrations) onto "cql" — they're irrelevant
  // here but the layout store persists them across profile switches.
  const tab: PostgresTab = activeTab === "schema" ? "schema" : "cql";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1">
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
        <div className="border-b border-line-soft px-3">
          <SegmentedControl
            namespace="postgres-tabs"
            ariaLabel="Postgres workspace tabs"
            value={tab}
            onChange={(next) => setActiveTab(next)}
            options={TAB_OPTIONS}
          />
        </div>
        <div key={tab} className="anim-fade-slide-up flex min-h-0 flex-1 flex-col">
          {tab === "schema" ? (
            <PostgresSchemaPanel profile={profile} />
          ) : (
            <CqlPanel
              queryText={queryText}
              queryResult={queryResult}
              loading={queryLoading}
              onChange={onQueryChange}
              onRun={onRun}
              title="SQL Console"
              hideQueryMode
              dialect="postgres"
              placeholder={`-- Run SQL against ${profile.name} (${profile.database})\nSELECT table_schema, table_name FROM information_schema.tables ORDER BY table_schema, table_name LIMIT 100;`}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function PostgresSchemaPanel({ profile }: { profile: PostgresProfileListItem }) {
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
      // Refresh on any successful statement — even a fully-rolled-back script
      // is worth a refresh because the user may have just learned which DDL
      // doesn't work and wants the sidebar to confirm the pre-script state.
      await refreshClusterSchema(profile.id);
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
        meta={`${profile.name} · transactional DDL`}
        actions={
          <Button
            variant="primary"
            onClick={() => setConfirmOpen(true)}
            disabled={running || !ddl.trim()}
            tooltip="Run the DDL against this database"
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
              dialect="postgres"
              placeholder={
                "-- Database DDL. Runs inside a single transaction — any failure rolls the whole script back.\n" +
                "-- Examples:\n" +
                "-- CREATE SCHEMA app;\n" +
                "-- CREATE TABLE app.users (id serial PRIMARY KEY, email text UNIQUE NOT NULL);\n" +
                "-- ALTER TABLE app.users ADD COLUMN created_at timestamptz DEFAULT now();"
              }
              ariaLabel="Postgres DDL editor"
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
              Statements run inside a single Postgres transaction. If any statement fails the entire
              script is rolled back. Continue?
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
  const rolledBack = result.rolledBack === true;
  return (
    <div className="max-h-[200px] overflow-y-auto border-t border-line-soft bg-panel-soft px-3 py-2 font-mono text-[11.5px]">
      <div className={`flex items-center gap-2 ${ok ? "text-success" : "text-danger"}`}>
        <span>{ok ? "✓" : "✗"}</span>
        <span>
          {result.statementsExecuted}/{result.totalStatements} statements · {result.durationMs}ms
          {rolledBack ? " · transaction rolled back" : ""}
        </span>
      </div>
      {result.error ? <pre className="mt-1 whitespace-pre-wrap text-danger">{result.error}</pre> : null}
      {result.statements.map((statement) => {
        // On rollback every ok=true statement was attempted-then-undone — we
        // mark it amber/"~" instead of green/"✓" so the user doesn't read it
        // as "this DDL persisted". A failed statement keeps its red ✗.
        const label = !statement.ok
          ? { glyph: "✗", color: "text-danger", tail: "" }
          : rolledBack
            ? { glyph: "~", color: "text-warning", tail: " (rolled back)" }
            : { glyph: "✓", color: "text-muted", tail: "" };
        return (
          <div key={statement.index} className="mt-1 border-t border-line-soft/60 pt-1 last:border-b-0">
            <div className={`flex items-center justify-between gap-2 ${label.color}`}>
              <span>
                {label.glyph} Statement {statement.index} · {statement.durationMs}ms{label.tail}
              </span>
            </div>
            <pre className="mt-0.5 whitespace-pre-wrap break-all text-text/80">{statement.cql}</pre>
            {statement.error ? <pre className="whitespace-pre-wrap text-danger">{statement.error}</pre> : null}
          </div>
        );
      })}
    </div>
  );
}
