import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionProfileWithPassword,
  createProfileFromDraft,
  SshConfig,
  validateStoredProfile,
} from "../core/config/profile";
import { SecretStore } from "./SecretStore";

/**
 * Split a profile's SSH config (which may carry the bastion password/passphrase)
 * into the plaintext-safe shape (no secrets) plus the extracted secrets. The
 * persisted JSON never contains the secrets — they go to the keychain, exactly
 * like the DB password.
 */
function splitSshSecrets(profile: ConnectionProfile): {
  profile: ConnectionProfile;
  secrets: { password?: string; passphrase?: string };
} {
  if (!profile.ssh) return { profile, secrets: {} };
  const { password, passphrase, ...authRest } = profile.ssh.auth;
  const sanitized: SshConfig = { ...profile.ssh, auth: authRest };
  const secrets: { password?: string; passphrase?: string } = {};
  if (password) secrets.password = password;
  if (passphrase) secrets.passphrase = passphrase;
  return { profile: { ...profile, ssh: sanitized }, secrets };
}

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
    const { password, ...rawProfile } = withPassword;
    const { profile, secrets: sshSecrets } = splitSshSecrets(rawProfile);
    const profiles = await this.list();
    await this.writeProfiles([...profiles, profile]);
    if (password) {
      await this.secrets.setPassword(profile.id, password);
    }
    if (profile.ssh) {
      await this.secrets.setSshSecrets(profile.id, sshSecrets);
    }
    return profile;
  }

  async createMany(drafts: ConnectionDraft[]): Promise<ConnectionProfile[]> {
    const created = drafts
      .map(createProfileFromDraft)
      .map(({ password, ...rawProfile }) => ({
        ...splitSshSecrets(rawProfile),
        password,
      }));
    const profiles = created.map(({ profile }) => profile);
    await this.writeProfiles([...(await this.list()), ...profiles]);
    await Promise.all(
      created.flatMap(({ profile, password, secrets }) => [
        password ? this.secrets.setPassword(profile.id, password) : Promise.resolve(),
        profile.ssh ? this.secrets.setSshSecrets(profile.id, secrets) : Promise.resolve(),
      ]),
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
    const { password, ...rawNext } = rebuilt;
    const { profile: next, secrets: sshSecrets } = splitSshSecrets(rawNext);
    const merged: ConnectionProfile = { ...next, id: profileId };
    const updated = [...profiles];
    updated[index] = merged;
    await this.writeProfiles(updated);
    if (password) {
      await this.secrets.setPassword(profileId, password);
    }
    if (!merged.ssh) {
      // SSH was removed (or never present) — clear any stale bastion secrets.
      await this.secrets.deleteSshSecrets(profileId);
    } else if (sshSecrets.password || sshSecrets.passphrase) {
      // Only overwrite when the user re-entered a secret. A blank field on edit
      // means "keep the stored one" (same semantics as the DB password).
      await this.secrets.setSshSecrets(profileId, sshSecrets);
    }
    return merged;
  }

  async delete(profileId: string): Promise<void> {
    const profiles = (await this.list()).filter(
      (profile) => profile.id !== profileId,
    );
    await this.writeProfiles(profiles);
    await this.secrets.deletePassword(profileId);
    await this.secrets.deleteSshSecrets(profileId);
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
    let result: ConnectionProfileWithPassword = password
      ? { ...profile, password }
      : profile;
    if (result.ssh) {
      // Re-attach the bastion secrets (stored separately in the keychain) onto
      // the ssh.auth so the connect path / tunnel can use them.
      const sshSecrets = await this.secrets.getSshSecrets(profileId);
      const auth: SshConfig["auth"] = { ...result.ssh.auth };
      if (sshSecrets.password) auth.password = sshSecrets.password;
      if (sshSecrets.passphrase) auth.passphrase = sshSecrets.passphrase;
      result = { ...result, ssh: { ...result.ssh, auth } };
    }
    return result;
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
