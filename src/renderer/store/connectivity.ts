import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ConnectivityState {
  /** Profile IDs the user last had connected. Restored as auto-connect targets on next boot. */
  autoConnectIds: string[];
}

interface ConnectivityActions {
  addAutoConnect(profileId: string): void;
  removeAutoConnect(profileId: string): void;
}

export const useConnectivityStore = create<ConnectivityState & ConnectivityActions>()(
  persist(
    (set) => ({
      autoConnectIds: [],
      addAutoConnect: (profileId) =>
        set((state) => ({
          autoConnectIds: state.autoConnectIds.includes(profileId)
            ? state.autoConnectIds
            : [...state.autoConnectIds, profileId],
        })),
      removeAutoConnect: (profileId) =>
        set((state) => ({
          autoConnectIds: state.autoConnectIds.filter((id) => id !== profileId),
        })),
    }),
    { name: "mordor-connectivity" },
  ),
);
