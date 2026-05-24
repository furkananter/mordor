import { create } from "zustand";
import { QueryResultPayload } from "../../core/shared/messages";
import { LoadState } from "./constants";
import { runWithStatus, useStatusStore } from "./status";
import { useConnectionStore } from "./connection";
import { usePreferencesStore } from "./preferences";
import { useSchemaStore } from "./schema";

interface QueryState {
  queryText: string;
  queryResult: QueryResultPayload | undefined;
  queryState: LoadState;
}

interface QueryActions {
  setQueryText(text: string): void;
  runQuery(): Promise<void>;
  resetForTable(initialText: string): void;
}

export const useQueryStore = create<QueryState & QueryActions>((set, get) => ({
  queryText: "",
  queryResult: undefined,
  queryState: "idle",

  setQueryText: (queryText) => set({ queryText }),

  resetForTable: (queryText) =>
    set({ queryText, queryResult: undefined, queryState: "idle" }),

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
        set({ queryResult, queryState: "loaded" });
      } catch (caught) {
        set({ queryState: "idle" });
        throw caught;
      }
    });
  },
}));
