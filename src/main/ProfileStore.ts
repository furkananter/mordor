import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionProfileWithPassword,
  createProfileFromDraft,
  validateStoredProfile,
} from "../core/config/profile";
import { SecretStore } from "./SecretStore";

interface ProfileFile {
  connections: unknown[];
}

export class ProfileStore {
  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretStore,
  ) {}

  async list(): Promise<ConnectionProfile[]> {
    const file = await this.readFile();
    return file.connections
      .map(validateStoredProfile)
      .filter((profile): profile is ConnectionProfile => Boolean(profile));
  }

  async create(draft: ConnectionDraft): Promise<ConnectionProfile> {
    const withPassword = createProfileFromDraft(draft);
    const { password, ...profile } = withPassword;
    const profiles = await this.list();
    await this.writeProfiles([...profiles, profile]);
    if (password) {
      await this.secrets.setPassword(profile.id, password);
    }
    return profile;
  }

  async createMany(drafts: ConnectionDraft[]): Promise<ConnectionProfile[]> {
    const created = drafts.map(createProfileFromDraft);
    const profiles = created.map(
      ({ password: _password, ...profile }) => profile,
    );
    await this.writeProfiles([...(await this.list()), ...profiles]);
    await Promise.all(
      created.map((profile) =>
        profile.password
          ? this.secrets.setPassword(profile.id, profile.password)
          : Promise.resolve(),
      ),
    );
    return profiles;
  }

  async update(
    profileId: string,
    draft: ConnectionDraft,
  ): Promise<ConnectionProfile> {
    const profiles = await this.list();
    const index = profiles.findIndex((profile) => profile.id === profileId);
    if (index === -1) {
      throw new Error("Connection profile was not found.");
    }
    const rebuilt = createProfileFromDraft(draft);
    const { password, ...next } = rebuilt;
    const merged: ConnectionProfile = { ...next, id: profileId };
    const updated = [...profiles];
    updated[index] = merged;
    await this.writeProfiles(updated);
    if (password) {
      await this.secrets.setPassword(profileId, password);
    }
    return merged;
  }

  async delete(profileId: string): Promise<void> {
    const profiles = (await this.list()).filter(
      (profile) => profile.id !== profileId,
    );
    await this.writeProfiles(profiles);
    await this.secrets.deletePassword(profileId);
  }

  async get(profileId: string): Promise<ConnectionProfile | undefined> {
    return (await this.list()).find((entry) => entry.id === profileId);
  }

  async getWithPassword(
    profileId: string,
  ): Promise<ConnectionProfileWithPassword | undefined> {
    const profile = (await this.list()).find((entry) => entry.id === profileId);
    if (!profile) {
      return undefined;
    }
    const password = await this.secrets.getPassword(profileId);
    return password ? { ...profile, password } : profile;
  }

  private async readFile(): Promise<ProfileFile> {
    try {
      const text = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(text) as Partial<ProfileFile>;
      return {
        connections: Array.isArray(parsed.connections)
          ? parsed.connections
          : [],
      };
    } catch {
      return { connections: [] };
    }
  }

  private async writeProfiles(profiles: ConnectionProfile[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify({ connections: profiles }, null, 2)}\n`,
      "utf8",
    );
  }
}
