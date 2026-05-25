import { CassandraService } from "../../core/cassandra/CassandraService";
import {
  discoverLocalConnections,
  isSameEndpoint,
  localDiscoveryCandidates,
  LocalDiscoveryCandidate
} from "../../core/cassandra/localDiscovery";
import {
  ConnectionProfile,
  ConnectionProfileWithPassword
} from "../../core/config/profile";
import {
  AdapterConnectResult,
  AdapterSchema,
  DatabaseAdapter,
  DetectedConnection
} from "../../core/db/types";

export class CassandraAdapter implements DatabaseAdapter {
  readonly type = "cassandra" as const;

  constructor(private readonly service: CassandraService) {}

  async connect(profile: ConnectionProfileWithPassword): Promise<AdapterConnectResult> {
    if (profile.type !== "cassandra") {
      throw new Error("CassandraAdapter received non-Cassandra profile.");
    }
    const keyspaces = await this.service.connect(profile);
    return { schema: { kind: "cassandra", keyspaces } };
  }

  disconnect(profileId: string): Promise<void> {
    return this.service.disconnect(profileId);
  }

  isConnected(profileId: string): boolean {
    return this.service.isConnected(profileId);
  }

  getSchema(profileId: string): AdapterSchema {
    return { kind: "cassandra", keyspaces: this.service.getSchema(profileId) };
  }

  async detectLocal(
    existing: ConnectionProfile[],
    log: (message: string) => void
  ): Promise<DetectedConnection[]> {
    const results = await discoverLocalConnections(existing, undefined, log);
    return results.map((result) => ({ draft: result.draft, notes: result.clusterName }));
  }

  isLocalCandidate(profile: ConnectionProfile): boolean {
    if (profile.type !== "cassandra") return false;
    return localDiscoveryCandidates.some((candidate: LocalDiscoveryCandidate) =>
      isSameEndpoint(profile, candidate)
    );
  }

  disposeAll(): Promise<void> {
    return this.service.dispose();
  }
}
