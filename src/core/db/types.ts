import {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionProfileWithPassword,
  ProfileType
} from "../config/profile";
import { KeyspaceNode } from "../cassandra/CassandraService";
import { PostgresSchemaNode } from "../postgres/types";

export interface DetectedConnection {
  draft: ConnectionDraft;
  notes?: string;
}

export interface DetectionResult {
  detected: DetectedConnection[];
  logs: string[];
}

/**
 * Schema payload returned by adapters. Tagged by `kind` so the renderer can
 * narrow on the variant before reading database-specific fields. Each adapter
 * must return exactly one variant matching its `type` field. As we add more
 * databases (postgres, mongodb, …) we extend this union, and every consumer
 * must add a branch (exhaustiveness errors are intentional — they're the
 * compiler reminding you to update the UI for the new shape).
 */
export type AdapterSchema =
  | { kind: "cassandra"; keyspaces: KeyspaceNode[] }
  | { kind: "redis" }
  | { kind: "postgres"; schemas: PostgresSchemaNode[] };

/** Helper: empty schema appropriate for a not-yet-connected profile. */
export function emptySchemaFor(type: ProfileType): AdapterSchema {
  switch (type) {
    case "cassandra":
      return { kind: "cassandra", keyspaces: [] };
    case "redis":
      return { kind: "redis" };
    case "postgres":
      return { kind: "postgres", schemas: [] };
    default: {
      // Throw instead of returning a fallback variant. The old code returned
      // a Cassandra-shaped empty schema for unknown types, which produced
      // profiles whose `type` and `schema.kind` disagreed — silently breaking
      // every consumer that narrows on `profile.type` and then reads
      // `profile.schema`. Loud failure surfaces the routing gap; the `never`
      // assignment guarantees a compile error first when a new ProfileType is
      // added without extending this switch.
      const _exhaustive: never = type;
      throw new Error(
        `emptySchemaFor: no empty schema defined for profile type "${String(_exhaustive)}". ` +
          `Add a case to the switch when extending ProfileType.`,
      );
    }
  }
}

export interface AdapterConnectResult {
  schema: AdapterSchema;
}

export interface DatabaseAdapter {
  readonly type: ProfileType;
  connect(profile: ConnectionProfileWithPassword): Promise<AdapterConnectResult>;
  disconnect(profileId: string): Promise<void>;
  isConnected(profileId: string): boolean;
  getSchema(profileId: string): AdapterSchema;
  detectLocal?(
    existing: ConnectionProfile[],
    log: (message: string) => void
  ): Promise<DetectedConnection[]>;
  isLocalCandidate?(profile: ConnectionProfile): boolean;
  disposeAll(): Promise<void>;
}
