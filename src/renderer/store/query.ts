import { create } from "zustand";
import { QueryResultPayload } from "../../core/shared/messages";
import { LoadState } from "./constants";
import { runWithStatus, useStatusStore } from "./status";
import { useConnectionStore } from "./connection";
import { usePreferencesStore } from "./preferences";
import { useSchemaStore } from "./schema";

const HISTORY_MAX = 50;

function historyKey(profileId: string): string {
  return `mordor:qh:${profileId}`;
}

function readHistory(profileId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(historyKey(profileId)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeHistory(profileId: string, entries: string[]): void {
  try {
    localStorage.setItem(historyKey(profileId), JSON.stringify(entries));
  } catch {
    // localStorage quota exceeded — history is a convenience, not critical
  }
}

interface QueryState {
  queryText: string;
  queryResult: QueryResultPayload | undefined;
  queryState: LoadState;
  history: string[];
}

interface QueryActions {
  setQueryText(text: string): void;
  runQuery(): Promise<void>;
  resetForTable(initialText: string): void;
  loadHistory(profileId: string): void;
}

export const useQueryStore = create<QueryState & QueryActions>((set, get) => ({
  queryText: "",
  queryResult: undefined,
  queryState: "idle",
  history: [],

  setQueryText: (queryText) => set({ queryText }),

  resetForTable: (queryText) =>
    set({ queryText, queryResult: undefined, queryState: "idle" }),

  loadHistory: (profileId) => {
    set({ history: readHistory(profileId) });
  },

  runQuery: async () => {
    const schemaState = useSchemaStore.getState();
    const profiles = useConnectionStore.getState().profiles;
    // Priority: explicit table selection → explicit cluster selection → first connected.
    const profileId =
      schemaState.selectedTable?.profileId ??
      schemaState.selectedProfileId ??
      profiles.find((profile) => profile.connected)?.id;
    if (!profileId) {
      useStatusStore
        .getState()
        .setError("Connect to Cassandra before running a CQL query.");
      return;
    }

    set({ queryState: "loading" });
    await runWithStatus("Running query", async () => {
      try {
        const mode = usePreferencesStore.getState().queryMode;
        const queryResult = await window.cassandraDesk.runSelectQuery(
          profileId,
          get().queryText,
          mode,
        );

        // Persist to per-profile history (newest first, deduplicated)
        const text = get().queryText.trim();
        if (text) {
          const prev = readHistory(profileId);
          const next = [text, ...prev.filter((q) => q !== text)].slice(0, HISTORY_MAX);
          writeHistory(profileId, next);
          set({ queryResult, queryState: "loaded", history: next });
        } else {
          set({ queryResult, queryState: "loaded" });
        }
      } catch (caught) {
        set({ queryState: "idle" });
        throw caught;
      }
    });
  },
}));
