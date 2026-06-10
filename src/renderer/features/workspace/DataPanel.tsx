import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronsDown, Plus, Radio } from "lucide-react";
import { PreviewRowsPayload, TableSchemaPayload } from "../../../core/shared/messages";
import { Button } from "../../components/ui/Button";
import { DataTable, DataTableDeleteConfig } from "../../components/ui/data-table/DataTable";
import { computeRowId } from "../../components/ui/data-table/types";
import { PanelHeader } from "../../components/ui/PanelHeader";
import { InsertRowDialog } from "./InsertRowDialog";
import { useLivePolling } from "../../hooks/useLivePolling";
import { LIVE_INTERVAL_OPTIONS_MS, LiveIntervalMs } from "../../store/constants";
import { usePreferencesStore } from "../../store/preferences";
import { useSchemaStore } from "../../store/schema";
import { useStatusStore } from "../../store/status";

const FRESH_TTL_MS = 4000;

export function DataPanel({
  preview,
  schema,
  loading
}: {
  preview: PreviewRowsPayload | undefined;
  schema: TableSchemaPayload | undefined;
  loading: boolean;
}) {
  const liveIntervalMs = usePreferencesStore((state) => state.liveIntervalMs);
  const setLiveIntervalMs = usePreferencesStore((state) => state.setLiveIntervalMs);
  const queryMode = usePreferencesStore((state) => state.queryMode);
  const reloadSelectedTable = useSchemaStore((state) => state.reloadSelectedTable);
  const refreshPreviewSilent = useSchemaStore((state) => state.refreshPreviewSilent);
  const loadMorePreview = useSchemaStore((state) => state.loadMorePreview);
  const loadAllPreview = useSchemaStore((state) => state.loadAllPreview);
  const previewLoadingMore = useSchemaStore((state) => state.previewLoadingMore);
  const previewLoadingAll = useSchemaStore((state) => state.previewLoadingAll);
  const setError = useStatusStore((state) => state.setError);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const canWrite = queryMode !== "read";

  const tableKey = schema
    ? `${schema.table.profileId}:${schema.table.keyspace}.${schema.table.table}`
    : undefined;

  // Snapshot of the previous tick keyed by row id → a signature of the row's
  // cell values. Lets us flag both rows that are *new* (id not seen before) and
  // rows that were *updated* in place (same id, changed signature). Resets on
  // table change / live toggle off.
  const baselineRef = useRef<Map<string, string> | undefined>(undefined);
  const freshRowsRef = useRef<Map<string, number>>(new Map());
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(new Set());

  // Disable live mode when the user switches tables — avoids polling a stale one mid-transition.
  useEffect(() => {
    setLiveEnabled(false);
    freshRowsRef.current = new Map();
    setFreshIds(new Set());
    baselineRef.current = undefined;
  }, [tableKey]);

  const { lastTickAt, pending } = useLivePolling({
    enabled: liveEnabled && Boolean(schema),
    intervalMs: liveIntervalMs,
    onTick: refreshPreviewSilent,
    key: tableKey
  });

  const pkColumnsForDiff = useMemo(
    () => (schema ? [...schema.partitionKeys, ...schema.clusteringKeys] : []),
    [schema]
  );

  // Diff each incoming preview against the previous snapshot. Rows that are new
  // *or* changed in place get a TTL, then expire — so highlights fade after
  // FRESH_TTL_MS.
  useEffect(() => {
    if (!liveEnabled || !preview || pkColumnsForDiff.length === 0) {
      baselineRef.current = undefined;
      if (freshRowsRef.current.size > 0) {
        freshRowsRef.current = new Map();
        setFreshIds(new Set());
      }
      return;
    }
    const columns = preview.columns;
    const current = new Map<string, string>();
    for (let index = 0; index < preview.rows.length; index += 1) {
      const row = preview.rows[index]!;
      const id = computeRowId(row, pkColumnsForDiff, index);
      current.set(id, rowSignature(row, columns));
    }
    if (baselineRef.current === undefined) {
      baselineRef.current = current;
      return;
    }
    const previousSnapshot = baselineRef.current;
    const now = Date.now();
    let mutated = false;
    for (const [id, signature] of current) {
      const previousSignature = previousSnapshot.get(id);
      // New row, or an existing row whose cell values changed.
      if (previousSignature === undefined || previousSignature !== signature) {
        freshRowsRef.current.set(id, now + FRESH_TTL_MS);
        mutated = true;
      }
    }
    baselineRef.current = current;
    if (mutated) setFreshIds(new Set(freshRowsRef.current.keys()));
  }, [preview, liveEnabled, pkColumnsForDiff]);

  // Prune expired fresh entries. The interval only triggers a state update
  // (and therefore a re-render) when something actually expires — so an idle
  // live mode with no incoming rows costs nothing per tick.
  useEffect(() => {
    if (!liveEnabled) return;
    const id = window.setInterval(() => {
      if (freshRowsRef.current.size === 0) return;
      const now = Date.now();
      let mutated = false;
      for (const [rowId, expiresAt] of freshRowsRef.current) {
        if (expiresAt <= now) {
          freshRowsRef.current.delete(rowId);
          mutated = true;
        }
      }
      if (mutated) setFreshIds(new Set(freshRowsRef.current.keys()));
    }, 500);
    return () => window.clearInterval(id);
  }, [liveEnabled]);

  const columnTypes = useMemo(() => {
    if (!schema) return undefined;
    return schema.columns.reduce<Record<string, string>>((acc, column) => {
      acc[column.name] = column.type;
      return acc;
    }, {});
  }, [schema]);

  const pkColumns = pkColumnsForDiff;

  // Memoize the delete config so DataTable receives a stable prop reference
  // across DataPanel re-renders. Without this, every live-mode tick would
  // hand DataTable a new object and force its internals to recompute.
  const deleteConfig: DataTableDeleteConfig | undefined = useMemo(() => {
    if (!schema) return undefined;
    return {
      label: "Delete",
      confirmTitle: "Delete selected rows?",
      confirmBody: (count) =>
        `${count} row${count === 1 ? "" : "s"} will be permanently removed from ${schema.table.keyspace}.${schema.table.table}. This cannot be undone.`,
      onConfirm: async (rows) => {
        try {
          await window.cassandraDesk.deleteTableRows(schema.table, rows);
          await reloadSelectedTable();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
          throw caught;
        }
      }
    };
  }, [schema, reloadSelectedTable, setError]);

  const hasMore = Boolean(preview?.pageState);
  const meta = preview ? `${preview.rows.length}${hasMore ? "+" : ""} rows` : "auto pageSize 1000";

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      <PanelHeader
        title="Preview"
        meta={meta}
        actions={
          <div className="flex items-center gap-2">
            {schema ? (
              <Button
                onClick={() => setInsertOpen(true)}
                disabled={!canWrite}
                tooltip={canWrite ? "Insert a row using the table schema" : "Enable Write or All mode in Settings to insert"}
              >
                <Plus size={12} strokeWidth={1.7} />
                <span>Add row</span>
              </Button>
            ) : null}
            {hasMore ? (
              <>
                <Button
                  onClick={() => void loadMorePreview()}
                  disabled={previewLoadingMore || previewLoadingAll}
                  tooltip={`Fetch the next ${preview?.limit ?? 1000} rows`}
                >
                  <ChevronDown size={12} strokeWidth={1.7} />
                  <span>{previewLoadingMore ? "Loading…" : `Load ${preview?.limit ?? 1000} more`}</span>
                </Button>
                <Button
                  onClick={() => void loadAllPreview()}
                  disabled={previewLoadingMore || previewLoadingAll}
                  tooltip="Fetch every remaining row, then Select all to delete them in one go"
                >
                  <ChevronsDown size={12} strokeWidth={1.7} />
                  <span>
                    {previewLoadingAll ? `Loading… (${preview?.rows.length ?? 0})` : "Load all"}
                  </span>
                </Button>
              </>
            ) : null}
            {liveEnabled ? <LiveStatusBadge lastTickAt={lastTickAt} pending={pending} intervalMs={liveIntervalMs} /> : null}
            <label className="flex items-center gap-1 text-[11.5px] text-muted">
              <span>Every</span>
              <select
                value={liveIntervalMs}
                onChange={(event) => setLiveIntervalMs(Number(event.target.value) as LiveIntervalMs)}
                className="rounded-ui border border-line bg-panel px-1.5 py-0.5 text-[11.5px] text-text focus-visible:border-accent focus-visible:outline-none"
                disabled={!schema}
              >
                {LIVE_INTERVAL_OPTIONS_MS.map((ms) => (
                  <option key={ms} value={ms}>
                    {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setLiveEnabled((value) => !value)}
              disabled={!schema}
              className={`inline-flex select-none items-center gap-1 rounded-ui border px-2 py-1 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                liveEnabled
                  ? "border-success bg-success/15 text-success hover:bg-success/20"
                  : "border-line bg-panel text-muted hover:bg-line-soft hover:text-text"
              }`}
              aria-pressed={liveEnabled}
              title={liveEnabled ? "Stop live polling" : "Start live polling"}
            >
              <Radio size={11} strokeWidth={1.7} className={liveEnabled ? "animate-pulse" : ""} />
              <span>Live</span>
            </button>
          </div>
        }
      />
      <DataTable
        result={preview}
        loading={loading}
        emptyTitle="No preview"
        emptyBody="The first 1000 rows load automatically."
        emptyRowsBody="The table returned an empty preview."
        columnTypes={columnTypes}
        enableSelection={Boolean(schema)}
        rowIdColumns={pkColumns}
        {...(schema ? { detailTitle: `${schema.table.keyspace}.${schema.table.table}` } : {})}
        {...(liveEnabled && freshIds.size > 0 ? { highlightRowIds: freshIds } : {})}
        {...(deleteConfig ? { deleteConfig } : {})}
      />
      {schema ? (
        <InsertRowDialog
          open={insertOpen}
          schema={schema}
          onOpenChange={setInsertOpen}
          onInserted={() => void reloadSelectedTable()}
        />
      ) : null}
    </section>
  );
}

/**
 * Owns the "Xs ago" relative-time tick locally so DataPanel (and its expensive
 * DataTable subtree) is not forced to re-render every second purely to refresh
 * a five-character label.
 */
function LiveStatusBadge({
  lastTickAt,
  pending,
  intervalMs
}: {
  lastTickAt: number | undefined;
  pending: boolean;
  intervalMs: number;
}) {
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNow((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span
      className="flex items-center gap-1 text-[11px] text-muted"
      title={`Polling every ${intervalMs / 1000}s`}
    >
      <LivePulse pending={pending} />
      <span>{formatLastTick(lastTickAt)}</span>
    </span>
  );
}

function LivePulse({ pending }: { pending: boolean }) {
  return (
    <span className="relative flex h-2 w-2 items-center justify-center">
      <span
        className={`absolute inline-flex h-full w-full rounded-full bg-success/60 ${pending ? "animate-ping" : ""}`}
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
    </span>
  );
}

/**
 * A cheap content fingerprint for a row: every cell value joined with a
 * separator that can't appear inside the serialized strings. Comparing these
 * across live-poll ticks tells an in-place UPDATE (same primary key, different
 * values) apart from an unchanged row.
 */
function rowSignature(row: Record<string, string>, columns: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < columns.length; i += 1) {
    parts.push(row[columns[i]!] ?? "");
  }
  // U+0001 can't occur in the serialized cell strings, so it's a safe field
  // boundary that keeps ["ab","c"] distinct from ["a","bc"].
  return parts.join("\u0001");
}

function formatLastTick(lastTickAt: number | undefined): string {
  if (!lastTickAt) return "waiting…";
  const seconds = Math.max(0, Math.round((Date.now() - lastTickAt) / 1000));
  if (seconds === 0) return "just now";
  if (seconds === 1) return "1s ago";
  return `${seconds}s ago`;
}
