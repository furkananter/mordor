import type Keytar from "keytar";
import { secretKeyForProfile } from "../core/config/profile";

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
}

export { serviceName as keychainServiceName };
