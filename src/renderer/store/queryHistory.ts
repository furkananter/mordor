import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Hard cap on retained run-history entries; oldest are evicted past this. */
export const QUERY_HISTORY_MAX = 200;

export interface QueryHistoryEntry {
  id: string;
  profileId: string;
  sql: string;
  /** Epoch millis the run completed — passed in by the caller. */
  ranAt: number;
  ok: boolean;
  rowCount?: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  /** Optional owning profile; absent = available everywhere. */
  profileId?: string;
}

interface QueryHistoryState {
  history: QueryHistoryEntry[];
  saved: SavedQuery[];
}

interface QueryHistoryActions {
  /**
   * Record a run at the front of the history (newest first), capped at
   * {@link QUERY_HISTORY_MAX} — oldest entries fall off the end.
   */
  recordRun(entry: {
    profileId: string;
    sql: string;
    ranAt: number;
    ok: boolean;
    rowCount?: number;
  }): void;
  clearHistory(): void;
  saveSnippet(snippet: { name: string; sql: string; profileId?: string }): void;
  renameSnippet(id: string, name: string): void;
  deleteSnippet(id: string): void;
}

export const useQueryHistoryStore = create<
  QueryHistoryState & QueryHistoryActions
>()(
  persist(
    (set) => ({
      history: [],
      saved: [],

      recordRun: (entry) =>
        set((state) => {
          const next: QueryHistoryEntry = {
            id: crypto.randomUUID(),
            profileId: entry.profileId,
            sql: entry.sql,
            ranAt: entry.ranAt,
            ok: entry.ok,
            ...(entry.rowCount === undefined ? {} : { rowCount: entry.rowCount }),
          };
          return {
            history: [next, ...state.history].slice(0, QUERY_HISTORY_MAX),
          };
        }),

      clearHistory: () => set({ history: [] }),

      saveSnippet: (snippet) =>
        set((state) => {
          const next: SavedQuery = {
            id: crypto.randomUUID(),
            name: snippet.name,
            sql: snippet.sql,
            ...(snippet.profileId === undefined
              ? {}
              : { profileId: snippet.profileId }),
          };
          return { saved: [...state.saved, next] };
        }),

      renameSnippet: (id, name) =>
        set((state) => ({
          saved: state.saved.map((snippet) =>
            snippet.id === id ? { ...snippet, name } : snippet,
          ),
        })),

      deleteSnippet: (id) =>
        set((state) => ({
          saved: state.saved.filter((snippet) => snippet.id !== id),
        })),
    }),
    { name: "mordor-query-history" },
  ),
);
