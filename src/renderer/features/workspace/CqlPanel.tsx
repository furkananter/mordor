import { lazy, Suspense, useMemo, useState } from "react";
import { History, Play, Zap } from "lucide-react";
import { QueryResultPayload, TableSchemaPayload } from "../../../core/shared/messages";
import { Button } from "../../components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
const CqlEditor = lazy(() => import("../../components/ui/cql-editor/CqlEditor").then((m) => ({ default: m.CqlEditor })));
import { DataTable } from "../../components/ui/data-table/DataTable";
import { useLayoutStore } from "../../store/layout";
import { usePreferencesStore } from "../../store/preferences";

export function CqlPanel({
  queryText,
  queryResult,
  loading,
  placeholder,
  schema,
  onChange,
  onRun,
  title = "CQL Console",
  hideQueryMode = false,
  dialect = "cassandra",
  history = [],
  onExplain,
  explainResult,
  explaining = false,
}: {
  queryText: string;
  queryResult: QueryResultPayload | undefined;
  loading: boolean;
  placeholder: string;
  schema?: TableSchemaPayload | undefined;
  onChange(value: string): void;
  onRun(): Promise<void>;
  /** Header label — defaults to "CQL Console", override for SQL etc. */
  title?: string;
  /** Hide the read/write mode pill for engines that don't honor it (Postgres). */
  hideQueryMode?: boolean;
  /**
   * Drives the CodeMirror SQL dialect + autocomplete tables. Cassandra is the
   * default since this panel ships with CQL Console; Postgres callers pass
   * "postgres" so RETURNING / jsonb / dollar-quoted bodies highlight
   * correctly and the completion list isn't full of CQL-only tokens.
   */
  dialect?: "cassandra" | "postgres";
  /** Per-profile query history, newest first. */
  history?: string[];
  /** If provided, renders an Explain button alongside Run (Postgres only). */
  onExplain?: () => Promise<void>;
  /** When set, renders the EXPLAIN plan text instead of the DataTable. */
  explainResult?: string | null;
  explaining?: boolean;
}) {
  const editorHeight = useLayoutStore((state) => state.cqlEditorHeight);
  const setEditorHeight = useLayoutStore((state) => state.setCqlEditorHeight);
  const [resizing, setResizing] = useState(false);

  const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const top = container.getBoundingClientRect().top;
    setResizing(true);
    const onMove = (move: MouseEvent) => setEditorHeight(move.clientY - top);
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const completions = useMemo(() => {
    if (!schema) return undefined;
    const qualified = `${schema.table.keyspace}.${schema.table.table}`;
    return {
      tables: [schema.table.table, qualified],
      columns: schema.columns.map((column) => column.name)
    };
  }, [schema]);

  const busy = loading || explaining;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <div className="flex items-center justify-between gap-2.5 border-b border-line-soft px-4 py-2">
        <div className="grid gap-0.5">
          <span className="text-[12px] font-medium text-text">{title}</span>
          <span className="text-[11.5px] text-muted">Cmd/Ctrl + Enter to run</span>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <HistoryDropdown history={history} onSelect={onChange} />
          )}
          {hideQueryMode ? null : <QueryModeBadge />}
          {onExplain && (
            <Button
              variant="ghost"
              onClick={() => void onExplain()}
              disabled={busy || !queryText.trim()}
              tooltip="EXPLAIN ANALYZE"
            >
              <Zap size={12} strokeWidth={1.7} />
              {explaining ? "Explaining…" : "Explain"}
            </Button>
          )}
          <Button variant="primary" onClick={() => void onRun()} disabled={busy}>
            <Play size={12} strokeWidth={1.7} />
            {loading ? "Running" : "Run"}
          </Button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <section
          className="relative flex min-w-0 shrink-0 flex-col overflow-hidden border-b border-line-soft"
          style={{ height: `${editorHeight}px` }}
        >
          <Suspense fallback={<div className="grid h-full place-items-center text-[11.5px] text-muted">Loading editor…</div>}>
            <CqlEditor
              value={queryText}
              onChange={onChange}
              onRun={() => void onRun()}
              placeholder={placeholder}
              ariaLabel="CQL editor"
              dialect={dialect}
              {...(completions ? { completions } : {})}
            />
          </Suspense>
        </section>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize editor"
          onMouseDown={handleResizeStart}
          data-active={resizing ? "true" : "false"}
          className="relative z-10 -my-1 h-2 cursor-row-resize bg-transparent transition-colors hover:bg-accent/60 data-[active=true]:bg-accent"
        />

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {explainResult != null ? (
            <ExplainPanel plan={explainResult} />
          ) : (
            <>
              {queryResult ? (
                <p className="border-b border-line-soft px-3 py-2 font-mono text-[11px] text-muted">
                  <span className="mr-2 text-accent">last</span>
                  <span className="break-all">{queryResult.cql}</span>
                </p>
              ) : null}
              <DataTable
                result={queryResult}
                loading={loading}
                emptyTitle="No query result"
                emptyBody="Run a SELECT query to see rows here."
                enableSelection
              />
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function HistoryDropdown({
  history,
  onSelect,
}: {
  history: string[];
  onSelect: (entry: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="icon" tooltip="Query history">
          <History size={14} strokeWidth={1.7} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[400px] min-w-[260px]">
        <DropdownMenuLabel>Recent queries</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {history.slice(0, 15).map((entry, i) => (
          <DropdownMenuItem
            key={i}
            onSelect={() => onSelect(entry)}
            className="flex-col items-start gap-0"
          >
            <span className="w-full truncate font-mono text-[11.5px] text-text">
              {entry.length > 80 ? entry.slice(0, 80) + "…" : entry}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExplainPanel({ plan }: { plan: string }) {
  // Extract timing summary from the last two lines of the plan text
  const lines = plan.trimEnd().split("\n");
  const summaryLines = lines.filter(
    (l) => l.includes("Planning Time") || l.includes("Execution Time"),
  );
  const summary = summaryLines.join(" · ").replace(/\s+/g, " ").trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {summary && (
        <p className="border-b border-line-soft px-3 py-2 font-mono text-[11px] text-muted">
          <span className="mr-2 text-accent">explain</span>
          <span>{summary}</span>
        </p>
      )}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-[11.5px] leading-relaxed text-text">
        {plan}
      </pre>
    </div>
  );
}

function QueryModeBadge() {
  const queryMode = usePreferencesStore((state) => state.queryMode);
  const dangerous = queryMode !== "read";
  const label = queryMode === "read" ? "Read only" : queryMode === "write" ? "Write" : "All";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] ${
        dangerous ? "bg-warning/15 text-warning" : "bg-line-soft text-muted"
      }`}
      title={dangerous ? "Mutations will execute against the live cluster" : "SELECT only"}
    >
      {label}
    </span>
  );
}
