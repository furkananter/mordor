import { create } from "zustand";
import { ConnectionListFilter } from "./constants";

interface StatusState {
  busy: string | undefined;
  error: string | undefined;
  logs: string[];
  showForm: boolean;
  connectionListFilter: ConnectionListFilter;
}

interface StatusActions {
  setBusy(busy: string | undefined): void;
  setError(error: string | undefined): void;
  setLogs(logs: string[]): void;
  setShowForm(showForm: boolean): void;
  setConnectionListFilter(filter: ConnectionListFilter): void;
}

export const useStatusStore = create<StatusState & StatusActions>((set) => ({
  busy: undefined,
  error: undefined,
  logs: [],
  showForm: false,
  connectionListFilter: "all",

  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
  setLogs: (logs) => set({ logs }),
  setShowForm: (showForm) => set({ showForm }),
  setConnectionListFilter: (connectionListFilter) => set({ connectionListFilter })
}));

export async function runWithStatus(label: string, action: () => Promise<void>): Promise<void> {
  const { setBusy, setError } = useStatusStore.getState();
  setBusy(label);
  setError(undefined);
  try {
    await action();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    setError(message);
  } finally {
    setBusy(undefined);
  }
}
