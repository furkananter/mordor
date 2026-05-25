import { ConnectionProfile } from "../../core/config/profile";
import { emptySchemaFor } from "../../core/db/types";
import {
  CreateProfileInput,
  ipcChannels,
  ProfileListItem,
} from "../../core/ipc";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import { ProfileStore } from "../ProfileStore";

export function createProfileHandlers(
  store: ProfileStore,
  adapters: AdapterRegistry,
) {
  const listProfiles = async (): Promise<ProfileListItem[]> => {
    const profiles = await store.list();
    return profiles.map((profile) => {
      const adapter = adapters.has(profile.type)
        ? adapters.forProfile(profile)
        : undefined;
      // When no adapter is registered (defensive — should not happen in
      // practice because every profile.type is paired with a registered
      // adapter at startup) we fall back to the empty schema variant
      // matching the profile.type so the renderer can still narrow on it.
      return {
        ...profile,
        connected: adapter?.isConnected(profile.id) ?? false,
        schema: adapter?.getSchema(profile.id) ?? emptySchemaFor(profile.type),
      } as ProfileListItem;
    });
  };

  async function autoConnectLocalProfiles(
    profiles: ConnectionProfile[],
    logs: string[],
  ): Promise<void> {
    for (const profile of profiles) {
      if (!adapters.has(profile.type)) continue;
      const adapter = adapters.forProfile(profile);
      if (adapter.isConnected(profile.id)) continue;
      if (!adapter.isLocalCandidate?.(profile)) continue;

      try {
        const profileWithPassword = await store.getWithPassword(profile.id);
        if (!profileWithPassword) {
          logs.push(`Auto-connect skipped: ${profile.name} no longer exists.`);
          continue;
        }
        await adapter.connect(profileWithPassword);
        logs.push(`Auto-connected ${profile.name}.`);
      } catch (error) {
        logs.push(
          `Auto-connect failed for ${profile.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return {
    listProfiles,

    [ipcChannels.listProfiles]: listProfiles,
    [ipcChannels.createProfile]: async (input: CreateProfileInput) => {
      await store.create(input);
      return listProfiles();
    },
    [ipcChannels.updateProfile]: async (
      profileId: string,
      input: CreateProfileInput,
    ) => {
      const existing = await store.get(profileId);
      if (existing && adapters.has(existing.type)) {
        await adapters.forProfile(existing).disconnect(profileId);
      }
      await store.update(profileId, input);
      return listProfiles();
    },
    [ipcChannels.deleteProfile]: async (profileId: string) => {
      const existing = await store.get(profileId);
      if (existing && adapters.has(existing.type)) {
        await adapters.forProfile(existing).disconnect(profileId);
      }
      await store.delete(profileId);
      return listProfiles();
    },
    [ipcChannels.detectLocalConnections]: async () => {
      const logs: string[] = [];
      const before = await store.list();
      const detected: Array<{
        draft: Awaited<ReturnType<typeof store.createMany>>[number] | unknown;
      }> = [];
      const draftsToSave = [];
      for (const adapter of adapters.all()) {
        if (!adapter.detectLocal) continue;
        try {
          const results = await adapter.detectLocal(before, (m) =>
            logs.push(m),
          );
          for (const result of results) {
            draftsToSave.push(result.draft);
            detected.push({ draft: result.draft });
          }
        } catch (caught) {
          logs.push(
            `Detection error in ${adapter.type}: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        }
      }
      if (draftsToSave.length > 0) await store.createMany(draftsToSave);
      const allProfiles = await store.list();
      await autoConnectLocalProfiles(allProfiles, logs);
      return { detected, profiles: await listProfiles(), logs };
    },
    [ipcChannels.connect]: async (profileId: string) => {
      const profile = await store.getWithPassword(profileId);
      if (!profile) throw new Error("Connection profile was not found.");
      const adapter = adapters.forProfile(profile);
      const result = await adapter.connect(profile);
      return { profileId, schema: result.schema };
    },
    [ipcChannels.disconnect]: async (profileId: string) => {
      const existing = await store.get(profileId);
      if (existing && adapters.has(existing.type)) {
        await adapters.forProfile(existing).disconnect(profileId);
      }
      return listProfiles();
    },
  };
}
