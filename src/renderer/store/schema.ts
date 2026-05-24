import { create } from "zustand";
import { PreviewRowsPayload, TableIdentity, TableSchemaPayload } from "../../core/shared/messages";
import { defaultQueryForTable } from "../lib/cql";
import { LoadState } from "./constants";
import { runWithStatus, useStatusStore } from "./status";
import { useLayoutStore } from "./layout";
import { useQueryStore } from "./query";
import { useRecentTablesStore } from "./recentTables";

interface SchemaState {
  selectedTable: TableIdentity | undefined;
  selectedProfileId: string | undefined;
  schema: TableSchemaPayload | undefined;
  preview: PreviewRowsPayload | undefined;
  tableState: LoadState;
  /** True while a load-more (next page) fetch is in flight. */
  previewLoadingMore: boolean;
}

interface SchemaActions {
  openTable(table: TableIdentity): Promise<void>;
  selectProfile(profileId: string): void;
  reloadSelectedTable(): Promise<void>;
  refreshPreviewSilent(): Promise<void>;
  loadMorePreview(): Promise<void>;
  clearTable(): void;
}

export const useSchemaStore = create<SchemaState & SchemaActions>((set, get) => ({
  selectedTable: undefined,
  selectedProfileId: undefined,
  schema: undefined,
  preview: undefined,
  tableState: "idle",
  previewLoadingMore: false,

  openTable: async (table) => {
    set({
      selectedTable: table,
      selectedProfileId: table.profileId,
      schema: undefined,
      preview: undefined,
      tableState: "loading"
    });
    useLayoutStore.getState().setActiveTab("data");
    useQueryStore.getState().resetForTable(defaultQueryForTable(table));
    useRecentTablesStore.getState().recordOpen(table);
    // Avoid eager import of useRedisStore to prevent cycles
    void import("./redis").then(({ useRedisStore }) => useRedisStore.getState().clearSelection());

    await runWithStatus("Loading table", async () => {
      try {
        const [schema, preview] = await Promise.all([
          window.cassandraDesk.getTableSchema(table),
          window.cassandraDesk.getPreview(table)
        ]);
        set({ schema, preview, tableState: "loaded" });
      } catch (caught) {
        set({ tableState: "idle" });
        throw caught;
      }
    });
  },

  reloadSelectedTable: async () => {
    const selected = get().selectedTable;
    if (selected) {
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
      // Skip the commit if the user moved away mid-flight.
      const stillSelected = get().selectedTable;
      if (
        !stillSelected ||
        stillSelected.profileId !== selected.profileId ||
        stillSelected.keyspace !== selected.keyspace ||
        stillSelected.table !== selected.table
      ) {
        return;
      }
      const previous = get().preview;
      if (!previous) return;
      const merged: PreviewRowsPayload = {
        columns: previous.columns,
        rows: [...previous.rows, ...next.rows],
        limit: previous.limit
      };
      if (next.pageState) merged.pageState = next.pageState;
      set({ preview: merged });
    } catch (caught) {
      useStatusStore.getState().setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      set({ previewLoadingMore: false });
    }
  },

  refreshPreviewSilent: async () => {
    const selected = get().selectedTable;
    if (!selected) return;
    try {
      const next = await window.cassandraDesk.getPreview(selected);
      // Skip if the user moved away while the fetch was in flight.
      const stillSelected = get().selectedTable;
      if (
        !stillSelected ||
        stillSelected.profileId !== selected.profileId ||
        stillSelected.keyspace !== selected.keyspace ||
        stillSelected.table !== selected.table
      ) {
        return;
      }
      // Live polling fires every few seconds; on a static table the returned
      // rows are byte-identical to what we already hold. Committing a fresh
      // reference would force TanStack to rebuild every row model (filter,
      // sort, pagination, selection) and re-render 500+ DOM rows for no gain,
      // which on release builds was eating ~50% of the main thread and
      // making the sidebar feel frozen. Cheap deep-equality lets us no-op
      // when nothing changed.
      const current = get().preview;
      if (current && previewsEqual(current, next)) return;
      set({ preview: next });
    } catch {
      // Live polling failures are silent — keep prior preview, surface nothing.
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
    // Default tab at cluster level should be CQL (Data/Schema/Migrations need a table).
    useLayoutStore.getState().setActiveTab("cql");
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
