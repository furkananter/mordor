import { create } from "zustand";
import { CreateProfileInput, ProfileListItem } from "../../core/ipc";
import { runWithStatus, useStatusStore } from "./status";
import { useSchemaStore } from "./schema";

interface ConnectionState {
  profiles: ProfileListItem[];
}

interface ConnectionActions {
  init(): Promise<void>;
  detectLocal(): Promise<void>;
  createProfile(input: CreateProfileInput): Promise<void>;
  updateProfile(
    profileId: string,
    input: CreateProfileInput,
  ): Promise<ProfileListItem[]>;
  deleteProfile(profileId: string): Promise<void>;
  connect(profileId: string): Promise<void>;
  disconnect(profileId: string): Promise<void>;
  /**
   * Re-fetch the keyspace/table list for a single cluster and update the
   * profile in the store. Use after DDL operations (migrations, CREATE TABLE,
   * DROP TABLE) so the sidebar tree reflects the new shape without requiring
   * an app restart.
   */
  refreshClusterSchema(profileId: string): Promise<void>;
}

function clearTableIfMatches(profileId: string): void {
  const selected = useSchemaStore.getState().selectedTable;
  if (selected?.profileId === profileId) {
    useSchemaStore.getState().clearTable();
  }
}

export const useConnectionStore = create<ConnectionState & ConnectionActions>(
  (set, get) => ({
    profiles: [],

    init: async () => {
      // Just load saved profiles on boot. Local detection is an explicit user action —
      // it must never create connections behind the user's back (especially Redis on
      // ports that happen to be open but don't speak the protocol).
      await runWithStatus("Loading connections", async () => {
        const profiles = await window.cassandraDesk.listProfiles();
        set({ profiles });
      });
    },

    detectLocal: async () => {
      await runWithStatus("Detecting local Cassandra", async () => {
        const result = await window.cassandraDesk.detectLocalConnections();
        if (result) {
          set({ profiles: result.profiles });
          useStatusStore.getState().setLogs(result.logs);
          return;
        }
        const profiles = await window.cassandraDesk.listProfiles();
        set({ profiles });
        useStatusStore.getState().setLogs([]);
      });
    },

    createProfile: async (input) => {
      await runWithStatus("Saving connection", async () => {
        const profiles = await window.cassandraDesk.createProfile(input);
        set({ profiles });
        useStatusStore.getState().setShowForm(false);
      });
    },

    updateProfile: async (profileId, input) => {
      let updated: ProfileListItem[] = get().profiles;
      await runWithStatus("Updating connection", async () => {
        updated = await window.cassandraDesk.updateProfile(profileId, input);
        set({ profiles: updated });
        clearTableIfMatches(profileId);
      });
      return updated;
    },

    deleteProfile: async (profileId) => {
      await runWithStatus("Deleting connection", async () => {
        const profiles = await window.cassandraDesk.deleteProfile(profileId);
        set({ profiles });
        clearTableIfMatches(profileId);
      });
    },

    connect: async (profileId) => {
      await runWithStatus("Connecting", async () => {
        await window.cassandraDesk.connect(profileId);
        const profiles = await window.cassandraDesk.listProfiles();
        set({ profiles });
      });
    },

    disconnect: async (profileId) => {
      await runWithStatus("Disconnecting", async () => {
        const profiles = await window.cassandraDesk.disconnect(profileId);
        set({ profiles });
        clearTableIfMatches(profileId);
      });
    },

    refreshClusterSchema: async (profileId) => {
      try {
        await window.cassandraDesk.refreshSchema(profileId);
        const profiles = await window.cassandraDesk.listProfiles();
        set({ profiles });
      } catch (caught) {
        // Surface the failure but don't blow up the caller — they likely just
        // finished a successful operation and the refresh is a secondary concern.
        useStatusStore
          .getState()
          .setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
  }),
);
