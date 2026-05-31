import { createConnection } from "node:net";
import type * as pg from "pg";
import {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionProfileWithPassword,
  isPostgresProfile,
} from "../../core/config/profile";
import {
  AdapterConnectResult,
  AdapterSchema,
  DatabaseAdapter,
  DetectedConnection,
} from "../../core/db/types";
import { PostgresService } from "../../core/postgres/PostgresService";
import { detectDockerPostgres } from "../docker/dockerProbe";

// Same lazy-load pattern as PostgresService — keep `pg` out of the boot path
// when the user never touches a Postgres profile (detect or otherwise).
let pgDriverPromise: Promise<typeof pg> | undefined;
async function loadPgDriver(): Promise<typeof pg> {
  if (!pgDriverPromise) pgDriverPromise = import("pg");
  return pgDriverPromise;
}

/**
 * Same envelope as the other adapters: thin wrapper over the service that
 * translates `connect`/`getSchema` into the tagged-union AdapterSchema, plus
 * local-discovery and lifecycle plumbing.
 */
export class PostgresAdapter implements DatabaseAdapter {
  readonly type = "postgres" as const;

  constructor(private readonly service: PostgresService) {}

  async connect(profile: ConnectionProfileWithPassword): Promise<AdapterConnectResult> {
    if (profile.type !== "postgres") {
      throw new Error("PostgresAdapter received non-Postgres profile.");
    }
    const schemas = await this.service.connect(profile);
    return { schema: { kind: "postgres", schemas } };
  }

  disconnect(profileId: string): Promise<void> {
    return this.service.disconnect(profileId);
  }

  isConnected(profileId: string): boolean {
    return this.service.isConnected(profileId);
  }

  getSchema(profileId: string): AdapterSchema {
    return { kind: "postgres", schemas: this.service.getSchemas(profileId) };
  }

  async detectLocal(
    existing: ConnectionProfile[],
    log: (message: string) => void,
  ): Promise<DetectedConnection[]> {
    const results: DetectedConnection[] = [];

    // --- Docker container probe ---
    // Read credentials directly from container env vars (POSTGRES_USER/PASSWORD/DB).
    // This covers project-specific setups (e.g. bourse/bourse/bourse) that the
    // generic credential matrix below would never guess.
    const dockerCandidates = await detectDockerPostgres(log);
    const dockerPorts = new Set<number>();

    for (const dc of dockerCandidates) {
      const alreadySaved = existing.find(
        (p) =>
          isPostgresProfile(p) &&
          p.host === dc.host &&
          p.port === dc.port,
      );
      if (alreadySaved) {
        log(
          `Docker container "${dc.containerName}" (${dc.host}:${dc.port}) already saved as "${alreadySaved.name}". ` +
            `Delete it first to re-detect.`,
        );
        dockerPorts.add(dc.port);
        continue;
      }

      const open = await probeTcp(dc.host, dc.port, PROBE_TIMEOUT_MS);
      if (!open) {
        log(`Docker container "${dc.containerName}" port ${dc.port} not reachable — skipping.`);
        continue;
      }

      log(`Docker container "${dc.containerName}" detected at ${dc.host}:${dc.port} (user=${dc.user}, db=${dc.database})`);
      dockerPorts.add(dc.port);

      const draft: ConnectionDraft = {
        type: "postgres",
        name: dc.containerName,
        host: dc.host,
        port: String(dc.port),
        database: dc.database,
        username: dc.user,
        password: dc.password,
        useTls: false,
      };
      results.push({ draft, notes: `Docker container (user=${dc.user})` });
    }

    // --- Generic localhost probe (non-Docker) ---
    // Skip ports already covered by Docker so we don't double-detect.
    for (const candidate of LOCAL_CANDIDATES) {
      if (dockerPorts.has(candidate.port)) continue;

      const savedLocal = existing.find(
        (profile) =>
          isPostgresProfile(profile) &&
          profile.port === candidate.port &&
          (profile.host === "127.0.0.1" || profile.host === "::1" || profile.host === "localhost"),
      );
      if (savedLocal) {
        log(
          `Local Postgres profile "${savedLocal.name}" already exists. ` +
            `Delete it first if you want Detect to re-probe credentials.`,
        );
        continue;
      }

      const open = await probeTcp(candidate.host, candidate.port, PROBE_TIMEOUT_MS);
      if (!open) continue;
      log(`Postgres TCP open at ${candidate.host}:${candidate.port}, probing credentials…`);

      const working = await probeCredentials(candidate, log);
      if (working) {
        const draft: ConnectionDraft = {
          type: "postgres",
          name: `Local Postgres (${candidate.host}:${candidate.port})`,
          host: candidate.host,
          port: String(candidate.port),
          database: working.database,
          username: working.user,
          password: working.password,
          useTls: false,
        };
        results.push({ draft, notes: `Local Postgres (user=${working.user})` });
        continue;
      }

      log(`Postgres at ${candidate.host}:${candidate.port} rejected all default credentials — edit the profile after saving.`);
      const draft: ConnectionDraft = {
        type: "postgres",
        name: `Local Postgres (${candidate.host}:${candidate.port})`,
        host: candidate.host,
        port: String(candidate.port),
        database: "postgres",
        username: "postgres",
        useTls: false,
      };
      results.push({ draft, notes: "Local Postgres (credentials required)" });
    }

    return results;
  }

  isLocalCandidate(profile: ConnectionProfile): boolean {
    if (!isPostgresProfile(profile)) return false;
    return LOCAL_CANDIDATES.some(
      (c) => c.port === profile.port && (c.host === profile.host),
    );
  }

  disposeAll(): Promise<void> {
    return this.service.dispose();
  }
}

const LOCAL_CANDIDATES = [
  { host: "127.0.0.1", port: 5432 },
  { host: "::1", port: 5432 },
];

const PROBE_TIMEOUT_MS = 600;

interface WorkingCredentials {
  user: string;
  password: string;
  database: string;
}

/**
 * Try a handful of common local-postgres credential combos. The matrix covers:
 *
 * - `postgres / postgres` — official docker image with default `POSTGRES_PASSWORD`
 * - `postgres / (empty)`  — trust auth (some bare installs)
 * - `$USER / (empty)`     — peer auth (brew install, postgres.app default)
 * - `$USER / $USER`       — some legacy macOS installs ship like this
 *
 * Each attempt has a tight 1.5 s timeout so a fully-deaf server doesn't make
 * detection hang the UI. First success wins; we end the probe client cleanly
 * so we don't pile up half-open connections on the server.
 */
async function probeCredentials(
  candidate: { host: string; port: number },
  log: (message: string) => void,
): Promise<WorkingCredentials | undefined> {
  const driver = await loadPgDriver();
  const osUser = (process.env["USER"] || process.env["USERNAME"] || "postgres").trim();
  const matrix: Array<{ user: string; password: string; database: string }> = [
    { user: "postgres", password: "postgres", database: "postgres" },
    { user: "postgres", password: "", database: "postgres" },
    { user: osUser, password: "", database: osUser },
    { user: osUser, password: "", database: "postgres" },
    { user: osUser, password: osUser, database: osUser },
  ];

  for (const attempt of matrix) {
    const client = new driver.Client({
      host: candidate.host,
      port: candidate.port,
      database: attempt.database,
      user: attempt.user,
      password: attempt.password,
      connectionTimeoutMillis: 1500,
    });
    try {
      await client.connect();
    } catch (caught) {
      // Quietly try the next combo. Each failed probe would otherwise spam
      // the user with red text for the common dev case where the right combo
      // is just further down the list.
      void caught;
      try {
        await client.end();
      } catch {
        // Half-open client; nothing to clean up further.
      }
      continue;
    }
    // Connect succeeded → the probe is conclusive. Return this credential
    // regardless of what end() does next. The previous version caught the
    // end() throw and moved on to the next combo, losing a working result;
    // the server then saw a successful auth followed by another attempt,
    // sometimes triggering rate-limiting on the next candidate.
    try {
      await client.end();
    } catch {
      // Server raced us to close; the socket is finished either way and the
      // credential is still the right answer.
    }
    log(`Postgres credentials probe succeeded with user="${attempt.user}", database="${attempt.database}"`);
    return attempt;
  }
  return undefined;
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
