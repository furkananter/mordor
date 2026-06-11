import { create } from "zustand";
import { PreviewRowsPayload, TableIdentity, TableSchemaPayload } from "../../core/shared/messages";
import { defaultQueryForTable } from "../lib/cql";
import { LoadState } from "./constants";
import { runWithStatus, useStatusStore } from "./status";
import { useLayoutStore } from "./layout";
import { useQueryStore } from "./query";
import { useRecentTablesStore } from "./recentTables";

// Hard ceiling for the "Load all" sweep. Past this, materializing every row in
// the renderer is the wrong tool — TRUNCATE / a targeted DELETE is. We stop and
// tell the user rather than risk an out-of-memory tab on a multi-million-row table.
const LOAD_ALL_ROW_CEILING = 50_000;

// In-memory preview cache keyed by "profileId:keyspace:table". Survives
// navigation within a session so a "load all" sweep isn't lost when the user
// switches tables and comes back. Not persisted — an app restart reloads fresh.
// Capped at MAX_CACHE_TABLES entries (insertion-order eviction) to prevent
// retaining many 50k-row snapshots simultaneously.
const MAX_CACHE_TABLES = 10;
const previewCache = new Map<string, PreviewRowsPayload>();

function cacheKey(table: TableIdentity): string {
  return `${table.profileId}:${table.keyspace}:${table.table}`;
}

function getPreviewCache(table: TableIdentity): PreviewRowsPayload | undefined {
  return previewCache.get(cacheKey(table));
}

function setPreviewCache(table: TableIdentity, preview: PreviewRowsPayload): void {
  const key = cacheKey(table);
  previewCache.delete(key); // move to end (most-recently-used)
  previewCache.set(key, preview);
  // Evict oldest entry when over the cap.
  if (previewCache.size > MAX_CACHE_TABLES) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
}

/** Called by the connection store when a profile disconnects to avoid stale cached rows. */
export function clearProfilePreviewCache(profileId: string): void {
  for (const key of previewCache.keys()) {
    if (key.startsWith(`${profileId}:`)) previewCache.delete(key);
  }
}

interface SchemaState {
  selectedTable: TableIdentity | undefined;
  selectedProfileId: string | undefined;
  schema: TableSchemaPayload | undefined;
  preview: PreviewRowsPayload | undefined;
  tableState: LoadState;
  /** True while a load-more (next page) fetch is in flight. */
  previewLoadingMore: boolean;
  /** True while a "load every remaining page" sweep is in flight. */
  previewLoadingAll: boolean;
}

interface SchemaActions {
  openTable(table: TableIdentity): Promise<void>;
  selectProfile(profileId: string): void;
  reloadSelectedTable(): Promise<void>;
  refreshPreviewSilent(): Promise<void>;
  /** Live-mode tick: fetches the first page and prepends genuinely new rows at the
   *  top of the current preview instead of replacing it, so loaded-all data is
   *  preserved and new arrivals appear immediately at the top. Falls back to
   *  refreshPreviewSilent when no PK columns are known. */
  refreshPreviewLive(): Promise<void>;
  loadMorePreview(): Promise<void>;
  loadAllPreview(): Promise<void>;
  clearTable(): void;
}

function sameTable(a: TableIdentity | undefined, b: TableIdentity): boolean {
  return (
    !!a &&
    a.profileId === b.profileId &&
    a.keyspace === b.keyspace &&
    a.table === b.table
  );
}

export const useSchemaStore = create<SchemaState & SchemaActions>((set, get) => ({
  selectedTable: undefined,
  selectedProfileId: undefined,
  schema: undefined,
  preview: undefined,
  tableState: "idle",
  previewLoadingMore: false,
  previewLoadingAll: false,

  openTable: async (table) => {
    const cached = getPreviewCache(table);

    set({
      selectedTable: table,
      selectedProfileId: table.profileId,
      schema: undefined,
      preview: cached,
      // Show as "loaded" immediately when we have cached rows — user sees data
      // right away while the schema metadata loads silently in the background.
      tableState: cached ? "loaded" : "loading"
    });
    useLayoutStore.getState().setActiveTab("data");
    useLayoutStore.getState().setLastNavigation(table.profileId, table);
    useQueryStore.getState().resetForTable(defaultQueryForTable(table));
    useRecentTablesStore.getState().recordOpen(table);
    void import("./redis").then(({ useRedisStore }) => useRedisStore.getState().clearSelection());

    if (cached) {
      // Schema metadata is small — refresh silently without a loading spinner.
      void window.cassandraDesk.getTableSchema(table).then((schema) => {
        if (!sameTable(get().selectedTable, table)) return;
        set({ schema });
      }).catch(() => {/* non-critical — columns panel stays empty */});
    } else {
      await runWithStatus("Loading table", async () => {
        try {
          const [schema, preview] = await Promise.all([
            window.cassandraDesk.getTableSchema(table),
            window.cassandraDesk.getPreview(table)
          ]);
          // Guard: user may have navigated away while the fetch was in flight.
          if (!sameTable(get().selectedTable, table)) return;
          set({ schema, preview, tableState: "loaded" });
          setPreviewCache(table, preview);
        } catch (caught) {
          if (sameTable(get().selectedTable, table)) set({ tableState: "idle" });
          throw caught;
        }
      });
    }
  },

  reloadSelectedTable: async () => {
    const selected = get().selectedTable;
    if (selected) {
      previewCache.delete(cacheKey(selected));
      await get().openTable(selected);
    }
  },

  loadMorePreview: async () => {
    const selected = get().selectedTable;
    const current = get().preview;
    const pageState = current?.pageState;
    if (!selected || !pageState || get().previewLoadingMore) return;
    set({ previewLoadingMore: true });
    try {
      const next = await window.cassandraDesk.getPreview(selected, pageState);
      if (!sameTable(get().selectedTable, selected)) return;
      const previous = get().preview;
      if (!previous) return;
      const merged: PreviewRowsPayload = {
        columns: previous.columns,
        rows: [...previous.rows, ...next.rows],
        limit: previous.limit
      };
      if (next.pageState) merged.pageState = next.pageState;
      set({ preview: merged });
      setPreviewCache(selected, merged);
    } catch (caught) {
      useStatusStore.getState().setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      set({ previewLoadingMore: false });
    }
  },

  loadAllPreview: async () => {
    const selected = get().selectedTable;
    if (!selected || !get().preview?.pageState) return;
    if (get().previewLoadingAll || get().previewLoadingMore) return;
    set({ previewLoadingAll: true });
    try {
      for (let page = 0; page < 10_000; page += 1) {
        const current = get().preview;
        const pageState = current?.pageState;
        if (!current || !pageState) break;
        if (current.rows.length >= LOAD_ALL_ROW_CEILING) {
          useStatusStore
            .getState()
            .setError(
              `Stopped after ${current.rows.length} rows — that's the load-all ceiling. For larger tables use TRUNCATE or a targeted DELETE instead.`,
            );
          break;
        }
        const next = await window.cassandraDesk.getPreview(selected, pageState);
        if (!sameTable(get().selectedTable, selected)) return;
        const previous = get().preview;
        if (!previous) return;
        const merged: PreviewRowsPayload = {
          columns: previous.columns,
          rows: [...previous.rows, ...next.rows],
          limit: previous.limit,
        };
        if (next.pageState) merged.pageState = next.pageState;
        set({ preview: merged });
        setPreviewCache(selected, merged);
      }
    } catch (caught) {
      useStatusStore.getState().setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      set({ previewLoadingAll: false });
    }
  },

  refreshPreviewSilent: async () => {
    const selected = get().selectedTable;
    if (!selected) return;
    try {
      const next = await window.cassandraDesk.getPreview(selected);
      if (!sameTable(get().selectedTable, selected)) return;
      const current = get().preview;
      if (current && previewsEqual(current, next)) return;
      set({ preview: next });
      setPreviewCache(selected, next);
    } catch {
      // Live polling failures are silent — keep prior preview, surface nothing.
    }
  },

  refreshPreviewLive: async () => {
    const selected = get().selectedTable;
    const schema = get().schema;
    if (!selected) return;

    const pkColumns = schema ? [...schema.partitionKeys, ...schema.clusteringKeys] : [];
    if (pkColumns.length === 0) {
      // No PK info yet — fall back to the standard silent refresh.
      return get().refreshPreviewSilent();
    }

    try {
      const next = await window.cassandraDesk.getPreview(selected);
      if (!sameTable(get().selectedTable, selected)) return;

      const current = get().preview;
      if (!current || current.rows.length === 0) {
        set({ preview: next });
        setPreviewCache(selected, next);
        return;
      }

      // Build the set of PK fingerprints already in our preview.
      const existingKeys = new Set(
        current.rows.map((row) => pkColumns.map((col) => row[col] ?? "").join("\x00"))
      );

      // Rows from the fresh first-page that aren't already present.
      const newRows = next.rows.filter(
        (row) => !existingKeys.has(pkColumns.map((col) => row[col] ?? "").join("\x00"))
      );

      if (newRows.length === 0) return;

      // Prepend new arrivals at the top; keep all previously-loaded rows intact.
      const merged: PreviewRowsPayload = {
        columns: current.columns,
        rows: [...newRows, ...current.rows],
        limit: current.limit,
      };
      if (current.pageState) merged.pageState = current.pageState;
      set({ preview: merged });
      setPreviewCache(selected, merged);
    } catch {
      // Silent failure — keep prior preview.
    }
  },

  selectProfile: (profileId) => {
    set({
      selectedProfileId: profileId,
      selectedTable: undefined,
      schema: undefined,
      preview: undefined,
      tableState: "idle"
    });
    useLayoutStore.getState().setActiveTab("cql");
    useLayoutStore.getState().setLastNavigation(profileId, undefined);
    useQueryStore.getState().resetForTable("");
    useStatusStore.getState().setError(undefined);
    void import("./redis").then(({ useRedisStore }) => useRedisStore.getState().clearSelection());
  },

  clearTable: () => {
    set({
      selectedTable: undefined,
      selectedProfileId: undefined,
      schema: undefined,
      preview: undefined,
      tableState: "idle"
    });
    useLayoutStore.getState().setActiveTab("data");
    useLayoutStore.getState().setLastNavigation(undefined);
    useQueryStore.getState().resetForTable("");
    useStatusStore.getState().setError(undefined);
  }
}));

/**
 * Cheap-ish deep equality for two previews. Compares column lists and every
 * cell value. For a typical 500-row × 10-column page this is ~5k string
 * compares (≈ 1 ms) — orders of magnitude cheaper than the React commit it
 * lets us avoid when live polling returns identical data.
 */
function previewsEqual(a: PreviewRowsPayload, b: PreviewRowsPayload): boolean {
  if (a.rows.length !== b.rows.length) return false;
  if (a.columns.length !== b.columns.length) return false;
  if (a.pageState !== b.pageState) return false;
  for (let i = 0; i < a.columns.length; i += 1) {
    if (a.columns[i] !== b.columns[i]) return false;
  }
  const columns = a.columns;
  for (let i = 0; i < a.rows.length; i += 1) {
    const ar = a.rows[i]!;
    const br = b.rows[i]!;
    for (let j = 0; j < columns.length; j += 1) {
      const col = columns[j]!;
      if (ar[col] !== br[col]) return false;
    }
  }
  return true;
}
