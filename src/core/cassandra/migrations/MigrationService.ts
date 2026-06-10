import {
  MigrationApplyResult,
  MigrationFile,
  MigrationListPayload,
  MigrationPreview
} from "../../shared/messages";
import { splitCqlStatements } from "../cqlSplit";
import { CassandraService } from "../CassandraService";
import { MigrationExecutor } from "./MigrationExecutor";
import { MigrationFileStore } from "./MigrationFileStore";
import { MigrationTracker } from "./MigrationTracker";
import { unusableTrackingError } from "./TrackingSchema";
import { AppliedRow, formatApplied, versionKeyVariants } from "./types";

function lookupApplied(applied: Map<string, AppliedRow>, version: string): AppliedRow | undefined {
  for (const key of versionKeyVariants(version)) {
    const row = applied.get(key);
    if (row) return row;
  }
  return undefined;
}

export class MigrationService {
  private readonly files = new MigrationFileStore();
  private readonly tracker = new MigrationTracker();
  private readonly executor = new MigrationExecutor(this.tracker);

  constructor(private readonly cassandra: CassandraService) {}

  async list(profileId: string, keyspace: string, folder: string): Promise<MigrationListPayload> {
    const client = this.cassandra.getClient(profileId);
    // A `schema_migrations` table is a very common name. Rather than failing on
    // a foreign one, resolve an adapter: absent (everything pending), native
    // (ours), adopted/adopted-readonly (someone else's, mapped by column), or
    // unusable (no version column → guided error).
    const adapter = await this.tracker.resolveTracking(client, keyspace);
    if (adapter.kind === "unusable") {
      throw unusableTrackingError(keyspace, adapter.columns);
    }
    const trackingTableReady = adapter.kind === "ready";
    const appliedByVersion = trackingTableReady
      ? await this.tracker.fetchApplied(client, keyspace, adapter)
      : new Map<string, AppliedRow>();
    const history = trackingTableReady ? await this.tracker.fetchHistory(client, keyspace) : [];

    const fileEntries = await this.files.list(folder);

    // Drift detection only makes sense against checksums Mordor itself wrote —
    // other tools (Flyway's CRC32, etc.) use incompatible checksum schemes, so
    // comparing would always report a spurious "modified".
    const driftAware = adapter.kind === "ready" && adapter.mode === "native";

    const files: MigrationFile[] = fileEntries.map((entry) => {
      const applied = lookupApplied(appliedByVersion, entry.version);
      if (!applied) {
        return {
          version: entry.version,
          name: entry.name,
          filename: entry.filename,
          status: "pending",
          checksum: entry.checksum
        };
      }
      const drifted = driftAware && applied.checksum != null && applied.checksum !== entry.checksum;
      if (!applied.success) {
        const failed: MigrationFile = {
          version: entry.version,
          name: entry.name,
          filename: entry.filename,
          status: "failed",
          checksum: entry.checksum,
          appliedAt: formatApplied(applied.applied_at)
        };
        if (driftAware && applied.checksum != null) failed.appliedChecksum = applied.checksum;
        if (applied.error_message) failed.failedReason = applied.error_message;
        return failed;
      }
      const file: MigrationFile = {
        version: entry.version,
        name: entry.name,
        filename: entry.filename,
        status: drifted ? "applied-modified" : "applied",
        checksum: entry.checksum,
        appliedAt: formatApplied(applied.applied_at)
      };
      if (driftAware && applied.checksum != null) file.appliedChecksum = applied.checksum;
      return file;
    });

    const payload: MigrationListPayload = { keyspace, folder, files, trackingTableReady, history };
    if (adapter.kind === "ready" && adapter.mode !== "native") {
      payload.tracking = { mode: adapter.mode, versionColumn: adapter.map.version };
      if (adapter.tool) payload.tracking.tool = adapter.tool;
    }
    return payload;
  }

  async ensureTrackingTable(profileId: string, keyspace: string): Promise<void> {
    const client = this.cassandra.getClient(profileId);
    await this.tracker.ensureTrackingTable(client, keyspace);
  }

  async readFile(folder: string, filename: string): Promise<string> {
    return this.files.readOne(folder, filename);
  }

  async writeFile(folder: string, filename: string, contents: string): Promise<void> {
    return this.files.writeOne(folder, filename, contents);
  }

  async create(folder: string, name: string): Promise<{ filename: string; version: string }> {
    return this.files.create(folder, name);
  }

  async preview(folder: string, version: string): Promise<MigrationPreview> {
    const entries = await this.files.list(folder);
    const entry = entries.find((candidate) => candidate.version === version);
    if (!entry) {
      throw new Error(`Migration ${version} not found in ${folder}.`);
    }
    return {
      version: entry.version,
      filename: entry.filename,
      statements: splitCqlStatements(entry.contents)
    };
  }

  async applyOne(profileId: string, keyspace: string, folder: string, version: string): Promise<MigrationApplyResult> {
    const entries = await this.files.list(folder);
    const entry = entries.find((candidate) => candidate.version === version);
    if (!entry) {
      throw new Error(`Migration ${version} not found in ${folder}.`);
    }

    // Run the migration through a dedicated client pinned to the migrations
    // keyspace, so unqualified table references inside the file resolve.
    return this.cassandra.runWithKeyspace(profileId, keyspace, async (client) => {
      const adapter = await this.tracker.ensureTrackingTable(client, keyspace);
      return this.executor.apply(client, keyspace, entry, adapter);
    });
  }
}
