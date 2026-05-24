import { lazy, Suspense, useEffect, useState } from "react";
import { Play, RefreshCw, RotateCcw } from "lucide-react";
import { SchemaScriptResult } from "../../../core/ipc";
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
import { useConnectionStore } from "../../store/connection";
import { useSchemaStore } from "../../store/schema";
import { useStatusStore } from "../../store/status";

const CqlEditor = lazy(() => import("../../components/ui/cql-editor/CqlEditor").then((m) => ({ default: m.CqlEditor })));

export function SchemaTab({ schema }: { schema: TableSchemaPayload | undefined }) {
  const reloadSelectedTable = useSchemaStore((state) => state.reloadSelectedTable);
  const refreshClusterSchema = useConnectionStore((state) => state.refreshClusterSchema);
  const setError = useStatusStore((state) => state.setError);
  const [ddl, setDdl] = useState("");
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SchemaScriptResult | undefined>(undefined);
  const [confirmRecreate, setConfirmRecreate] = useState(false);

  const tableKey = schema ? `${schema.table.profileId}:${schema.table.keyspace}.${schema.table.table}` : undefined;

  useEffect(() => {
    if (!schema) return;
    setResult(undefined);
    let cancelled = false;
    setLoading(true);
    window.cassandraDesk
      .getTableDdl(schema.table)
      .then((cql) => {
        if (cancelled) return;
        setDdl(cql);
        setBaseline(cql);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tableKey, schema, setError]);

  if (!schema) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-panel text-[11.5px] text-muted">
        Select a table to view its DDL.
      </section>
    );
  }

  const dirty = ddl !== baseline;

  const runScript = async (cqlToRun: string) => {
    setRunning(true);
    setResult(undefined);
    try {
      const next = await window.cassandraDesk.runSchemaScript(schema.table.profileId, cqlToRun);
      setResult(next);
      if (!next.error) {
        // Refresh the cluster's keyspace/table list so the sidebar reflects
        // any structural changes (new tables, dropped tables, renamed columns).
        await Promise.all([reloadSelectedTable(), refreshClusterSchema(schema.table.profileId)]);
        // Refresh baseline so dirty indicator resets.
        try {
          const fresh = await window.cassandraDesk.getTableDdl(schema.table);
          setDdl(fresh);
          setBaseline(fresh);
        } catch {
          /* ignore — main reload already completed */
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  const handleRecreateConfirm = async () => {
    const dropCql = `DROP TABLE IF EXISTS "${schema.table.keyspace}"."${schema.table.table}";\n`;
    setConfirmRecreate(false);
    await runScript(dropCql + ddl);
  };

  const reloadFromDb = async () => {
    setLoading(true);
    setResult(undefined);
    try {
      const fresh = await window.cassandraDesk.getTableDdl(schema.table);
      setDdl(fresh);
      setBaseline(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <PanelHeader
        title="Schema"
        meta={
          dirty
            ? "modified"
            : loading
              ? "loading…"
              : `${schema.table.keyspace}.${schema.table.table}`
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Button onClick={() => void reloadFromDb()} disabled={loading || running} tooltip="Reload DDL from database">
              <RefreshCw size={11} strokeWidth={1.7} />
              <span>Reload</span>
            </Button>
            <Button onClick={() => void runScript(ddl)} disabled={loading || running || !ddl.trim()} tooltip="Run the DDL as-is (use for ALTER, CREATE INDEX, …)">
              <Play size={11} strokeWidth={1.7} />
              <span>{running ? "Running…" : "Apply"}</span>
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirmRecreate(true)}
              disabled={loading || running || !ddl.trim()}
              tooltip="DROP existing table, then run the CQL — destroys all rows"
            >
              <RotateCcw size={11} strokeWidth={1.7} />
              <span>Drop &amp; Recreate</span>
            </Button>
          </div>
        }
      />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-px">
        <div className="min-h-0 overflow-hidden">
          <Suspense fallback={<div className="grid h-full place-items-center text-[11.5px] text-muted">Loading editor…</div>}>
            <CqlEditor
              value={ddl}
              onChange={setDdl}
              onRun={() => void runScript(ddl)}
              placeholder="-- CREATE TABLE ks.tbl ( … );"
              ariaLabel="Table DDL editor"
            />
          </Suspense>
        </div>
        <ResultPanel result={result} />
      </div>

      <AlertDialog open={confirmRecreate} onOpenChange={(open) => (running ? null : setConfirmRecreate(open))}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Drop and recreate this table?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-text">
                {schema.table.keyspace}.{schema.table.table}
              </strong>{" "}
              will be dropped first, then the CQL above will be executed. All existing rows will be permanently lost.
              Use this for development iteration only.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={running}
              onClick={(event) => {
                event.preventDefault();
                void handleRecreateConfirm();
              }}
            >
              {running ? "Recreating…" : "Drop & recreate"}
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
