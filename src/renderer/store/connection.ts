import { create } from "zustand";
import { CreateProfileInput, ProfileListItem } from "../../core/ipc";
import { runWithStatus, useStatusStore } from "./status";
import { useSchemaStore, clearProfilePreviewCache } from "./schema";
import { useConnectivityStore } from "./connectivity";

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
   * Silently reconnect a set of profiles (e.g. on app boot). Fires all
   * connections in parallel and swallows failures so one unreachable host
   * doesn't block the others.
   */
  reconnectProfiles(profileIds: string[]): Promise<void>;
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
        clearProfilePreviewCache(profileId);
        useConnectivityStore.getState().removeAutoConnect(profileId);
      });
    },

    connect: async (profileId) => {
      await runWithStatus("Connecting", async () => {
        await window.cassandraDesk.connect(profileId);
        const profiles = await window.cassandraDesk.listProfiles();
        set({ profiles });
        useConnectivityStore.getState().addAutoConnect(profileId);
      });
    },

    disconnect: async (profileId) => {
      await runWithStatus("Disconnecting", async () => {
        const profiles = await window.cassandraDesk.disconnect(profileId);
        set({ profiles });
        clearTableIfMatches(profileId);
        clearProfilePreviewCache(profileId);
        useConnectivityStore.getState().removeAutoConnect(profileId);
      });
    },

    reconnectProfiles: async (profileIds) => {
      if (profileIds.length === 0) return;
      // Fire all reconnects in parallel; swallow individual failures so one
      // unreachable host doesn't prevent the others from connecting.
      await Promise.allSettled(
        profileIds.map((id) => window.cassandraDesk.connect(id))
      );
      const profiles = await window.cassandraDesk.listProfiles();
      set({ profiles });
    },

    refreshClusterSchema: async (profileId) => {
      try {
        await window.cassandraDesk.refreshSchema(profileId);
        const profiles = await window.cassandraDesk.listProfiles();
        set({ profiles });
      } catch (caught) {
        useStatusStore
          .getState()
          .setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
  }),
);
