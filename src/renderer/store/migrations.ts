import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  MigrationApplyResult,
  MigrationListPayload,
} from "../../core/shared/messages";
import { LoadState } from "./constants";
import { runWithStatus } from "./status";
import { useConnectionStore } from "./connection";

interface MigrationsState {
  migrationsEnabled: boolean;
  migrationsList: MigrationListPayload | undefined;
  migrationsState: LoadState;
  migrationsLog: string[];
}

interface MigrationsActions {
  setMigrationsEnabled(enabled: boolean): void;
  updateProfileMigrations(
    profileId: string,
    folder: string,
    keyspace: string,
  ): Promise<void>;
  loadMigrations(profileId: string): Promise<void>;
  applyMigration(
    profileId: string,
    version: string,
  ): Promise<MigrationApplyResult | undefined>;
}

export const useMigrationsStore = create<MigrationsState & MigrationsActions>()(
  persist(
    (set) => ({
      migrationsEnabled: false,
      migrationsList: undefined,
      migrationsState: "idle",
      migrationsLog: [],

      setMigrationsEnabled: (enabled) =>
        set({
          migrationsEnabled: enabled,
          migrationsList: undefined,
          migrationsLog: [],
        }),

      updateProfileMigrations: async (profileId, folder, keyspace) => {
        const profile = useConnectionStore
          .getState()
          .profiles.find((entry) => entry.id === profileId);
        if (!profile || profile.type !== "cassandra") return;
        await runWithStatus("Saving migrations config", async () => {
          await useConnectionStore.getState().updateProfile(profileId, {
            type: "cassandra",
            name: profile.name,
            contactPoints: profile.contactPoints.join(", "),
            port: String(profile.port),
            localDataCenter: profile.localDataCenter,
            keyspace: profile.keyspace ?? "",
            username: profile.username ?? "",
            password: "",
            useTls: profile.useTls,
            migrationsFolder: folder,
            migrationsKeyspace: keyspace,
          });
          set({ migrationsList: undefined });
        });
      },

      loadMigrations: async (profileId) => {
        const profile = useConnectionStore
          .getState()
          .profiles.find((entry) => entry.id === profileId);
        if (profile && profile.type !== "cassandra") {
          set({ migrationsList: undefined });
          return;
        }
        const folder = profile?.migrationsFolder;
        const keyspace = profile?.migrationsKeyspace;
        if (!profile || !folder || !keyspace || !profile.connected) {
          set({ migrationsList: undefined });
          return;
        }
        set({ migrationsState: "loading" });
        await runWithStatus("Reading migrations", async () => {
          try {
            const payload = await window.cassandraDesk.listMigrations(
              profileId,
              keyspace,
              folder,
            );
            set({ migrationsList: payload, migrationsState: "loaded" });
          } catch (caught) {
            set({ migrationsState: "idle" });
            throw caught;
          }
        });
      },

      applyMigration: async (profileId, version) => {
        const profile = useConnectionStore
          .getState()
          .profiles.find((entry) => entry.id === profileId);
        if (!profile || profile.type !== "cassandra") return undefined;
        const folder = profile.migrationsFolder;
        const keyspace = profile.migrationsKeyspace;
        if (!folder || !keyspace) return undefined;
        let result: MigrationApplyResult | undefined;
        await runWithStatus(`Applying ${version}`, async () => {
          result = await window.cassandraDesk.applyMigration(
            profileId,
            keyspace,
            folder,
            version,
          );
          const payload = await window.cassandraDesk.listMigrations(
            profileId,
            keyspace,
            folder,
          );
          set({ migrationsList: payload });
          // The migration may have created/dropped tables — refresh the cluster
          // schema so the sidebar tree reflects the new shape immediately.
          if (result?.statementsExecuted && result.statementsExecuted > 0) {
            await useConnectionStore.getState().refreshClusterSchema(profileId);
          }
        });
        return result;
      },
    }),
    {
      name: "mordor-migrations",
      partialize: (state) => ({ migrationsEnabled: state.migrationsEnabled }),
    },
  ),
);
