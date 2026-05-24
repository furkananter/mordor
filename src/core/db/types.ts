import {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionProfileWithPassword,
  ProfileType
} from "../config/profile";
import { KeyspaceNode } from "../cassandra/CassandraService";

export interface DetectedConnection {
  draft: ConnectionDraft;
  notes?: string;
}

export interface DetectionResult {
  detected: DetectedConnection[];
  logs: string[];
}

export interface AdapterConnectResult {
  schema: KeyspaceNode[];
}

export interface DatabaseAdapter {
  readonly type: ProfileType;
  connect(profile: ConnectionProfileWithPassword): Promise<AdapterConnectResult>;
  disconnect(profileId: string): Promise<void>;
  isConnected(profileId: string): boolean;
  getSchema(profileId: string): KeyspaceNode[];
  detectLocal?(
    existing: ConnectionProfile[],
    log: (message: string) => void
  ): Promise<DetectedConnection[]>;
  isLocalCandidate?(profile: ConnectionProfile): boolean;
  disposeAll(): Promise<void>;
}
