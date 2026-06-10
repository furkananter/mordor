import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChevronRight, Database, Play, Table2 } from "lucide-react";
import { ProfileListItem, SchemaScriptResult } from "../../../core/ipc";
import { TableSchemaPayload } from "../../../core/shared/messages";
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
import { SchemaInspector } from "./SchemaInspector";

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
          <ClusterSchemaView profile={profile} />
        </TabPanel>
      </section>
    </div>
  );
}

// ─── Schema tab ──────────────────────────────────────────────────────────────

type SchemaMode = "browse" | "ddl";

const SCHEMA_MODE_OPTIONS: SegmentedOption<SchemaMode>[] = [
  { value: "browse", label: "Browse" },
  { value: "ddl", label: "Apply DDL" }
];

function ClusterSchemaView({ profile }: { profile: ProfileListItem }) {
  const [mode, setMode] = useState<SchemaMode>("browse");

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <div className="flex items-center justify-between border-b border-line-soft px-3 py-1.5">
        <span className="text-[11.5px] text-muted">{profile.name}</span>
        <SegmentedControl
          namespace="schema-mode"
          ariaLabel="Schema view mode"
          value={mode}
          onChange={setMode}
          options={SCHEMA_MODE_OPTIONS}
        />
      </div>
      {mode === "browse" ? (
        <ClusterSchemaBrowser profile={profile} />
      ) : (
        <ClusterSchemaDdlPanel profile={profile} />
      )}
    </section>
  );
}

// ─── Schema browser ──────────────────────────────────────────────────────────

function ClusterSchemaBrowser({ profile }: { profile: ProfileListItem }) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [tableSchema, setTableSchema] = useState<TableSchemaPayload | undefined>(undefined);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const setError = useStatusStore((state) => state.setError);
  const requestSeq = useRef(0);

  const keyspaces = profile.schema.kind === "cassandra" ? profile.schema.keyspaces : [];

  const handleSelectTable = async (keyspace: string, table: string) => {
    const key = `${keyspace}.${table}`;
    // Allow retry after a failed load (tableSchema still undefined); skip if
    // already loaded and not in-flight.
    if (key === selectedKey && tableSchema && !loadingSchema) return;

    const requestId = ++requestSeq.current;
    setSelectedKey(key);
    setTableSchema(undefined);
    setLoadingSchema(true);
    try {
      const schema = await window.cassandraDesk.getTableSchema({
        profileId: profile.id,
        profileName: profile.name,
        keyspace,
        table
      });
      if (requestId !== requestSeq.current) return;
      setTableSchema(schema);
    } catch (caught) {
      if (requestId !== requestSeq.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId !== requestSeq.current) return;
      setLoadingSchema(false);
    }
  };

  // Reset when profile changes; bump request seq to discard in-flight fetches.
  useEffect(() => {
    requestSeq.current += 1;
    setSelectedKey(undefined);
    setTableSchema(undefined);
    setLoadingSchema(false);
  }, [profile.id]);

  if (keyspaces.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[11.5px] text-muted">
        {profile.schema.kind === "cassandra"
          ? "No keyspaces found. Connect and refresh to populate the schema."
          : "Schema not available for this connection type."}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left: keyspace → table tree */}
      <div className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-line-soft bg-panel-soft">
        {keyspaces.map((ks) => (
          <KeyspaceSection
            key={ks.name}
            name={ks.name}
            tables={ks.tables}
            selectedKey={selectedKey}
            onSelectTable={(table) => void handleSelectTable(ks.name, table)}
          />
        ))}
      </div>

      {/* Right: column inspector */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedKey ? (
          <SchemaInspector schema={loadingSchema ? undefined : tableSchema} />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[11.5px] text-muted">
            Select a table to view its columns.
          </div>
        )}
      </div>
    </div>
  );
}

function KeyspaceSection({
  name,
  tables,
  selectedKey,
  onSelectTable
}: {
  name: string;
  tables: Array<{ name: string }>;
  selectedKey: string | undefined;
  onSelectTable(table: string): void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle hover:bg-line-soft/60"
      >
        <ChevronRight
          size={11}
          strokeWidth={1.7}
          className={`shrink-0 text-subtle transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Database size={10} strokeWidth={1.7} className="shrink-0 text-subtle" />
        <span className="truncate">{name}</span>
        <span className="ml-auto shrink-0 text-[10px] font-normal text-muted">{tables.length}</span>
      </button>
      {open ? (
        <ul>
          {tables.map((t) => {
            const key = `${name}.${t.name}`;
            const active = key === selectedKey;
            return (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => onSelectTable(t.name)}
                  className={`flex w-full items-center gap-1.5 py-1 pl-6 pr-2 text-left text-[12px] ${
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-text hover:bg-line-soft/60"
                  }`}
                >
                  <Table2 size={11} strokeWidth={1.7} className="shrink-0 text-subtle" />
                  <span className="truncate">{t.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ─── DDL apply panel ─────────────────────────────────────────────────────────

function ClusterSchemaDdlPanel({ profile }: { profile: ProfileListItem }) {
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
        title="Apply DDL"
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
        <DdlResultPanel result={result} />
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

function DdlResultPanel({ result }: { result: SchemaScriptResult | undefined }) {
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
