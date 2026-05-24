import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TableIdentity } from "../../core/shared/messages";

const MAX_RECENTS = 12;

export interface RecentTable {
  table: TableIdentity;
  openedAt: number;
}

interface RecentTablesState {
  recents: RecentTable[];
}

interface RecentTablesActions {
  recordOpen(table: TableIdentity): void;
  clear(): void;
  removeByProfile(profileId: string): void;
}

function sameTable(a: TableIdentity, b: TableIdentity): boolean {
  return (
    a.profileId === b.profileId &&
    a.keyspace === b.keyspace &&
    a.table === b.table
  );
}

export const useRecentTablesStore = create<
  RecentTablesState & RecentTablesActions
>()(
  persist(
    (set) => ({
      recents: [],
      recordOpen: (table) =>
        set((state) => {
          const filtered = state.recents.filter(
            (entry) => !sameTable(entry.table, table),
          );
          return {
            recents: [{ table, openedAt: Date.now() }, ...filtered].slice(
              0,
              MAX_RECENTS,
            ),
          };
        }),
      clear: () => set({ recents: [] }),
      removeByProfile: (profileId) =>
        set((state) => ({
          recents: state.recents.filter(
            (entry) => entry.table.profileId !== profileId,
          ),
        })),
    }),
    { name: "mordor-recents" },
  ),
);
