import type Keytar from "keytar";
import {
  secretKeyForProfile,
  secretKeyForSshPassphrase,
  secretKeyForSshPassword,
} from "../core/config/profile";

const serviceName = "mordor";

// keytar pulls a native addon — we don't want to require it during main-process
// boot when no profile has been touched yet. Lazy-load once and cache.
let keytarPromise: Promise<typeof Keytar> | undefined;
async function getKeytar(): Promise<typeof Keytar> {
  if (!keytarPromise) {
    keytarPromise = import("keytar").then((mod) => mod.default ?? mod);
  }
  return keytarPromise;
}

export class SecretStore {
  async getPassword(profileId: string): Promise<string | undefined> {
    const keytar = await getKeytar();
    return (
      (await keytar.getPassword(serviceName, secretKeyForProfile(profileId))) ??
      undefined
    );
  }

  async setPassword(profileId: string, password: string): Promise<void> {
    const keytar = await getKeytar();
    await keytar.setPassword(
      serviceName,
      secretKeyForProfile(profileId),
      password,
    );
  }

  async deletePassword(profileId: string): Promise<void> {
    const keytar = await getKeytar();
    await keytar.deletePassword(serviceName, secretKeyForProfile(profileId));
  }

  // --- SSH tunnel secrets ---
  // Stored under their own keychain accounts so they're independent of the DB
  // password and can be set/cleared without touching it. Mirrors the DB
  // password lifecycle (set on save, deleted with the profile).

  async getSshSecrets(
    profileId: string,
  ): Promise<{ password?: string; passphrase?: string }> {
    const keytar = await getKeytar();
    const [password, passphrase] = await Promise.all([
      keytar.getPassword(serviceName, secretKeyForSshPassword(profileId)),
      keytar.getPassword(serviceName, secretKeyForSshPassphrase(profileId)),
    ]);
    const secrets: { password?: string; passphrase?: string } = {};
    if (password) secrets.password = password;
    if (passphrase) secrets.passphrase = passphrase;
    return secrets;
  }

  async setSshSecrets(
    profileId: string,
    secrets: { password?: string; passphrase?: string },
  ): Promise<void> {
    const keytar = await getKeytar();
    await Promise.all([
      secrets.password
        ? keytar.setPassword(serviceName, secretKeyForSshPassword(profileId), secrets.password)
        : keytar.deletePassword(serviceName, secretKeyForSshPassword(profileId)),
      secrets.passphrase
        ? keytar.setPassword(serviceName, secretKeyForSshPassphrase(profileId), secrets.passphrase)
        : keytar.deletePassword(serviceName, secretKeyForSshPassphrase(profileId)),
    ]);
  }

  async deleteSshSecrets(profileId: string): Promise<void> {
    const keytar = await getKeytar();
    await Promise.all([
      keytar.deletePassword(serviceName, secretKeyForSshPassword(profileId)),
      keytar.deletePassword(serviceName, secretKeyForSshPassphrase(profileId)),
    ]);
  }
}

export { serviceName as keychainServiceName };
