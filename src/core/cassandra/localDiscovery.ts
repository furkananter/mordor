import { Socket } from "node:net";
import { ConnectionDraft, ConnectionProfile } from "../config/profile";

export interface LocalDiscoveryCandidate {
  host: string;
  port: number;
}

export interface LocalDiscoveryResult {
  draft: ConnectionDraft;
  clusterName: string;
  metadataRead: boolean;
  releaseVersion?: string;
}

interface LocalRow {
  cluster_name?: string;
  data_center?: string;
  release_version?: string;
}

export const localDiscoveryCandidates: LocalDiscoveryCandidate[] = [
  { host: "127.0.0.1", port: 9042 },
  { host: "127.0.0.1", port: 9142 },
  { host: "127.0.0.1", port: 19042 },
];

export function isSameEndpoint(
  profile: ConnectionProfile,
  candidate: LocalDiscoveryCandidate,
): boolean {
  if (profile.type !== "cassandra") return false;
  return (
    profile.port === candidate.port &&
    profile.contactPoints.includes(candidate.host)
  );
}

export function createDetectedDraft(
  candidate: LocalDiscoveryCandidate,
  row: LocalRow,
): LocalDiscoveryResult {
  const clusterName = row.cluster_name?.trim() || "Local Cassandra";
  const localDataCenter = row.data_center?.trim() || "datacenter1";

  const result: LocalDiscoveryResult = {
    clusterName,
    metadataRead: true,
    draft: {
      type: "cassandra",
      name: `${clusterName} (${candidate.host}:${candidate.port})`,
      contactPoints: candidate.host,
      port: String(candidate.port),
      localDataCenter,
      useTls: false,
    },
  };

  const releaseVersion = row.release_version?.trim();
  if (releaseVersion) {
    result.releaseVersion = releaseVersion;
  }

  return result;
}

export async function discoverLocalConnections(
  existingProfiles: ConnectionProfile[],
  candidates = localDiscoveryCandidates,
  log: (message: string) => void = () => undefined,
): Promise<LocalDiscoveryResult[]> {
  const candidatesToProbe = candidates.filter(
    (candidate) =>
      !existingProfiles.some((profile) => isSameEndpoint(profile, candidate)),
  );

  log(`Checking ${candidatesToProbe.length} localhost endpoint(s).`);
  const results = await Promise.all(
    candidatesToProbe.map((candidate) => probeCandidate(candidate, log)),
  );
  return results.filter((result): result is LocalDiscoveryResult =>
    Boolean(result),
  );
}

async function probeCandidate(
  candidate: LocalDiscoveryCandidate,
  log: (message: string) => void,
): Promise<LocalDiscoveryResult | undefined> {
  const endpoint = `${candidate.host}:${candidate.port}`;
  log(`Probing ${endpoint}...`);
  const isOpen = await canOpenTcpConnection(candidate);
  if (!isOpen) {
    log(`${endpoint} is closed or timed out.`);
    return undefined;
  }

  log(`${endpoint} is open. Trying Cassandra metadata...`);
  // Lazy import keeps the 5 MB driver out of cold-start. The detect-local
  // flow is an explicit user click, so spending the import time here is fine.
  const cassandra = await import("cassandra-driver");
  const client = new cassandra.Client({
    contactPoints: [candidate.host],
    localDataCenter: "datacenter1",
    protocolOptions: {
      port: candidate.port,
    },
    socketOptions: {
      connectTimeout: 900,
      readTimeout: 1200,
    },
  });

  try {
    await client.connect();
    const result = await client.execute(
      "SELECT cluster_name, data_center, release_version FROM system.local WHERE key = 'local'",
    );
    const row = result.first() as LocalRow | null;
    if (!row) {
      log(`${endpoint} responded, but system.local returned no metadata.`);
      return createFallbackDraft(candidate);
    }

    log(`${endpoint} metadata read succeeded.`);
    return createDetectedDraft(candidate, row);
  } catch (error) {
    log(
      `${endpoint} metadata read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return createFallbackDraft(candidate);
  } finally {
    await client.shutdown().catch(() => undefined);
  }
}

function createFallbackDraft(
  candidate: LocalDiscoveryCandidate,
): LocalDiscoveryResult {
  return {
    clusterName: "Local Cassandra",
    metadataRead: false,
    draft: {
      type: "cassandra",
      name: `Local Cassandra (${candidate.host}:${candidate.port})`,
      contactPoints: candidate.host,
      port: String(candidate.port),
      localDataCenter: "datacenter1",
      useTls: false,
    },
  };
}

function canOpenTcpConnection(
  candidate: LocalDiscoveryCandidate,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (isOpen: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(isOpen);
    };

    socket.setTimeout(650);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(candidate.port, candidate.host);
  });
}
