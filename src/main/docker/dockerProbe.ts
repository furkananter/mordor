import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DockerPostgresCandidate {
  containerName: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface DockerInspectEntry {
  Name?: string;
  Config?: {
    Env?: string[];
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
}

/**
 * Probe running Docker containers for PostgreSQL credentials.
 *
 * Reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from each
 * container's environment and resolves the host-side port bound to container
 * port 5432. Only containers that expose 5432 and carry at least one of the
 * Postgres env vars are returned.
 *
 * Fails gracefully: if Docker is not installed, not running, or the socket is
 * not accessible, the function logs a short message and returns an empty array
 * rather than throwing.
 */
export async function detectDockerPostgres(
  log: (message: string) => void,
): Promise<DockerPostgresCandidate[]> {
  // Step 1: list running container IDs
  let idOutput: string;
  try {
    const { stdout } = await execFileAsync("docker", ["ps", "-q"], {
      timeout: 5000,
    });
    idOutput = stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ENOENT → docker not installed; EACCES / permission denied → no socket access
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log("Docker not found on PATH — skipping container credential probe.");
    } else {
      log(`Docker probe skipped: ${msg}`);
    }
    return [];
  }

  if (!idOutput) return [];

  const ids = idOutput.split("\n").filter(Boolean);

  // Step 2: inspect all containers in one call
  let inspectRaw: string;
  try {
    const { stdout } = await execFileAsync("docker", ["inspect", ...ids], {
      timeout: 8000,
    });
    inspectRaw = stdout;
  } catch (err) {
    log(`Docker inspect failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  let entries: DockerInspectEntry[];
  try {
    entries = JSON.parse(inspectRaw) as DockerInspectEntry[];
  } catch {
    log("Docker inspect returned unparseable JSON — skipping.");
    return [];
  }

  const candidates: DockerPostgresCandidate[] = [];

  for (const entry of entries) {
    const envMap = parseEnv(entry.Config?.Env ?? []);

    // Only interested in containers that have at least one POSTGRES_ var
    if (!envMap["POSTGRES_USER"] && !envMap["POSTGRES_PASSWORD"] && !envMap["POSTGRES_DB"]) {
      continue;
    }

    const hostPort = resolveHostPort(entry.NetworkSettings?.Ports ?? {});
    if (!hostPort) continue; // 5432 not published to host

    const user = envMap["POSTGRES_USER"] ?? "postgres";
    const password = envMap["POSTGRES_PASSWORD"] ?? "";
    // POSTGRES_DB defaults to POSTGRES_USER when not set
    const database = envMap["POSTGRES_DB"] ?? user;

    // Strip leading slash from container name ("/my-container" → "my-container")
    const containerName = (entry.Name ?? "postgres").replace(/^\//, "");

    candidates.push({
      containerName,
      host: "127.0.0.1",
      port: hostPort,
      user,
      password,
      database,
    });
  }

  return candidates;
}

function parseEnv(env: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of env) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    map[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return map;
}

/**
 * Find the host-side port for container port 5432/tcp.
 * Returns undefined if the port is not published.
 */
function resolveHostPort(
  ports: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>,
): number | undefined {
  const binding = ports["5432/tcp"];
  if (!binding || binding.length === 0) return undefined;
  const portStr = binding[0]?.HostPort;
  if (!portStr) return undefined;
  const n = parseInt(portStr, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
