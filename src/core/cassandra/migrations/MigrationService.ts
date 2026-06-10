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
import { formatApplied } from "./types";

export class MigrationService {
  private readonly files = new MigrationFileStore();
  private readonly tracker = new MigrationTracker();
  private readonly executor = new MigrationExecutor(this.tracker);

  constructor(private readonly cassandra: CassandraService) {}

  async list(profileId: string, keyspace: string, folder: string): Promise<MigrationListPayload> {
    const client = this.cassandra.getClient(profileId);
    // Distinguish "no tracking table yet" (fine — everything is pending) from
    // "a foreign schema_migrations table is squatting the name" (surface a
    // guided error rather than letting the SELECT fail with a cryptic message).
    const trackingStatus = await this.tracker.inspectTrackingTable(client, keyspace);
    if (trackingStatus === "incompatible") {
      await this.tracker.assertTrackingTableUsable(client, keyspace);
    }
    const trackingTableReady = trackingStatus === "compatible";
    const appliedByVersion = trackingTableReady ? await this.tracker.fetchApplied(client, keyspace) : new Map();
    const history = trackingTableReady ? await this.tracker.fetchHistory(client, keyspace) : [];

    const fileEntries = await this.files.list(folder);

    const files: MigrationFile[] = fileEntries.map((entry) => {
      const applied = appliedByVersion.get(entry.version);
      if (!applied) {
        return {
          version: entry.version,
          name: entry.name,
          filename: entry.filename,
          status: "pending",
          checksum: entry.checksum
        };
      }
      if (!applied.success) {
        const failed: MigrationFile = {
          version: entry.version,
          name: entry.name,
          filename: entry.filename,
          status: "failed",
          checksum: entry.checksum,
          appliedChecksum: applied.checksum,
          appliedAt: formatApplied(applied.applied_at)
        };
        if (applied.error_message) failed.failedReason = applied.error_message;
        return failed;
      }
      return {
        version: entry.version,
        name: entry.name,
        filename: entry.filename,
        status: applied.checksum === entry.checksum ? "applied" : "applied-modified",
        checksum: entry.checksum,
        appliedChecksum: applied.checksum,
        appliedAt: formatApplied(applied.applied_at)
      };
    });

    return { keyspace, folder, files, trackingTableReady, history };
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
      await this.tracker.ensureTrackingTable(client, keyspace);
      return this.executor.apply(client, keyspace, entry);
    });
  }
}
