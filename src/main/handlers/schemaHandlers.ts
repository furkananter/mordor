import { CassandraService } from "../../core/cassandra/CassandraService";
import { QueryMode } from "../../core/cassandra/query";
import { ConnectionProfile } from "../../core/config/profile";
import { AdapterSchema } from "../../core/db/types";
import { ipcChannels } from "../../core/ipc";
import { PostgresService } from "../../core/postgres/PostgresService";
import { TableIdentity } from "../../core/shared/messages";
import { ProfileStore } from "../ProfileStore";

/**
 * Generic schema/table/query handlers that dispatch to the right service per
 * profile.type. Cassandra and Postgres share the same renderer-facing payloads
 * (TableSchemaPayload, PreviewRowsPayload, QueryResultPayload), which is what
 * makes a single set of IPC channels work for both.
 *
 * `keyspace` in TableIdentity is reinterpreted as the Postgres schema name —
 * a temporary semantic overload to avoid renaming the shared shape until the
 * MongoDB branch lands (where the field will be properly generalized).
 */
export function createSchemaHandlers(
  store: ProfileStore,
  cassandra: CassandraService,
  postgres: PostgresService,
) {
  const requireProfile = async (profileId: string): Promise<ConnectionProfile> => {
    const profile = await store.get(profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found.`);
    return profile;
  };

  /**
   * Build a "not supported on <type>" error for handlers that don't apply to
   * every DB. We *could* let these silently fall through to one of the engines
   * (the original code did, defaulting to Cassandra), but that hides routing
   * bugs and — for destructive ops like deleteRows — risks running them
   * against the wrong cluster on a profile-id collision. Loud failure beats
   * silent corruption.
   */
  const unsupported = (op: string, profile: ConnectionProfile): Error =>
    new Error(`${op} is not supported for ${profile.type} profiles ("${profile.name}").`);

  return {
    [ipcChannels.refreshSchema]: async (profileId: string): Promise<AdapterSchema> => {
      const profile = await requireProfile(profileId);
      if (profile.type === "cassandra") {
        const keyspaces = await cassandra.refreshSchema(profileId);
        return { kind: "cassandra", keyspaces };
      }
      if (profile.type === "postgres") {
        const schemas = await postgres.refreshSchema(profileId);
        return { kind: "postgres", schemas };
      }
      if (profile.type === "redis") {
        // Redis genuinely has no schema; return its empty variant. This is the
        // ONLY type allowed to fall through — anything else is a routing bug.
        return { kind: "redis" };
      }
      // Exhaustiveness: forces a compile error when a new ProfileType lands
      // without updating this switch. The throw is the runtime safety net.
      const _exhaustive: never = profile;
      throw new Error(`refreshSchema: unknown profile type ${(_exhaustive as ConnectionProfile).type}`);
    },
    [ipcChannels.getTableSchema]: async (table: TableIdentity) => {
      const profile = await requireProfile(table.profileId);
      if (profile.type === "cassandra") return cassandra.fetchTableSchema(table);
      if (profile.type === "postgres") return postgres.fetchTableSchema(table);
      throw unsupported("getTableSchema", profile);
    },
    [ipcChannels.getPreview]: async (table: TableIdentity, pageState?: string) => {
      const profile = await requireProfile(table.profileId);
      if (profile.type === "cassandra") return cassandra.fetchPreviewRows(table, pageState);
      if (profile.type === "postgres") return postgres.fetchPreviewRows(table, pageState);
      throw unsupported("getPreview", profile);
    },
    [ipcChannels.runSelectQuery]: async (
      profileId: string,
      sql: string,
      mode?: QueryMode,
    ) => {
      const profile = await requireProfile(profileId);
      if (profile.type === "cassandra") return cassandra.runSelectQuery(profileId, sql, mode);
      if (profile.type === "postgres") {
        // pg has no "read-only" mode at the SDK level; mode is honored by the
        // Cassandra path only. For pg, the user's SQL runs as-is — the form
        // labels the editor "SQL" so the expectation is clear.
        return postgres.runSelectQuery(profileId, sql);
      }
      throw unsupported("runSelectQuery", profile);
    },
    [ipcChannels.deleteTableRows]: async (
      table: TableIdentity,
      rows: Array<Record<string, string>>,
    ) => {
      const profile = await requireProfile(table.profileId);
      if (profile.type === "cassandra") return cassandra.deleteRows(table, rows);
      // Postgres row delete UX is a planned follow-up. Until then we reject
      // explicitly — otherwise a Postgres profileId would have been silently
      // routed to cassandra.deleteRows, which on a name collision could
      // DELETE from the wrong cluster.
      throw unsupported("deleteTableRows", profile);
    },
    [ipcChannels.insertTableRow]: async (
      table: TableIdentity,
      values: Record<string, string>,
    ) => {
      const profile = await requireProfile(table.profileId);
      if (profile.type === "cassandra") return cassandra.insertRow(table, values);
      if (profile.type === "postgres") return postgres.insertRow(table, values);
      throw unsupported("insertTableRow", profile);
    },
    [ipcChannels.getTableDdl]: async (table: TableIdentity) => {
      const profile = await requireProfile(table.profileId);
      if (profile.type === "cassandra") return cassandra.fetchTableDdl(table);
      if (profile.type === "postgres") return postgres.fetchTableDdl(table);
      throw unsupported("getTableDdl", profile);
    },
    [ipcChannels.runSchemaScript]: async (profileId: string, sql: string) => {
      const profile = await requireProfile(profileId);
      if (profile.type === "cassandra") return cassandra.runSchemaScript(profileId, sql);
      if (profile.type === "postgres") return postgres.runSchemaScript(profileId, sql);
      throw unsupported("runSchemaScript", profile);
    },
  };
}
