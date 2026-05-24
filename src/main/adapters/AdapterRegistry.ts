import { ConnectionProfile, ProfileType } from "../../core/config/profile";
import { DatabaseAdapter } from "../../core/db/types";

export class AdapterRegistry {
  private readonly adapters = new Map<ProfileType, DatabaseAdapter>();

  register(adapter: DatabaseAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: ProfileType): DatabaseAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for type "${type}".`);
    }
    return adapter;
  }

  has(type: ProfileType): boolean {
    return this.adapters.has(type);
  }

  forProfile(profile: ConnectionProfile): DatabaseAdapter {
    return this.get(profile.type);
  }

  all(): DatabaseAdapter[] {
    return [...this.adapters.values()];
  }

  async disposeAll(): Promise<void> {
    await Promise.all(this.all().map((adapter) => adapter.disposeAll()));
  }
}
