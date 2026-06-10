import type * as cassandra from "cassandra-driver";
import { MigrationApplyResult } from "../../shared/messages";
import { splitCqlStatements } from "../cqlSplit";
import { MigrationTracker } from "./MigrationTracker";
import { TrackingAdapter } from "./TrackingSchema";
import { MigrationEntry } from "./types";

export class MigrationExecutor {
  constructor(private readonly tracker: MigrationTracker) {}

  async apply(
    client: cassandra.Client,
    keyspace: string,
    entry: MigrationEntry,
    adapter: TrackingAdapter
  ): Promise<MigrationApplyResult> {
    const statements = splitCqlStatements(entry.contents);
    const total = statements.length;
    const started = Date.now();
    let executed = 0;
    let schemaAgreementOk = true;

    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]!;
      try {
        // The caller (MigrationService) hands us a client that's already
        // pinned to `keyspace` via runWithKeyspace, so unqualified
        // CREATE/ALTER/INSERT references resolve without any per-query work.
        await client.execute(statement);
        executed += 1;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        const detailed = `Statement ${index + 1}/${total} failed: ${message}`;
        await this.tracker.recordResult(
          client,
          keyspace,
          entry,
          { success: false, error: detailed, executed, total },
          adapter
        );
        return {
          version: entry.version,
          filename: entry.filename,
          statementsExecuted: executed,
          totalStatements: total,
          durationMs: Date.now() - started,
          schemaAgreementOk,
          error: detailed,
          failedStatement: { index: index + 1, total, cql: statement }
        };
      }
      if (isSchemaChange(statement)) {
        const agreed = await waitForSchemaAgreement(client);
        if (!agreed) schemaAgreementOk = false;
      }
    }

    await this.tracker.recordResult(client, keyspace, entry, { success: true, executed, total }, adapter);
    return {
      version: entry.version,
      filename: entry.filename,
      statementsExecuted: executed,
      totalStatements: total,
      durationMs: Date.now() - started,
      schemaAgreementOk
    };
  }
}

export function isSchemaChange(statement: string): boolean {
  const head = statement.replace(/^\s+/, "").slice(0, 32).toUpperCase();
  return /^(CREATE|ALTER|DROP|USE)\b/.test(head);
}

export async function waitForSchemaAgreement(
  client: cassandra.Client,
  timeoutMs = 10000,
  intervalMs = 250
): Promise<boolean> {
  const metadata = client.metadata as unknown as {
    checkSchemaAgreement?: () => Promise<boolean>;
  };
  if (typeof metadata.checkSchemaAgreement !== "function") return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const agreed = await metadata.checkSchemaAgreement();
      if (agreed) return true;
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}
