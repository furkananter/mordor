import { createServer, type Server, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import type { Client as SshClient, ConnectConfig } from "ssh2";
import type { SshConfig } from "../../core/config/profile";

// ssh2 pulls native-ish crypto wiring on require. Lazy-load once and cache so
// cold start doesn't pay the cost when no SSH-tunnelled profile is touched.
// Mirrors the lazy-load pattern used by RedisAdapter / PostgresService.
type Ssh2Module = { Client: new () => SshClient };
let ssh2Promise: Promise<Ssh2Module> | undefined;
async function loadSsh2(): Promise<Ssh2Module> {
  if (!ssh2Promise) {
    ssh2Promise = import("ssh2").then((m) => (m as unknown as Ssh2Module));
  }
  return ssh2Promise;
}

export interface TunnelTarget {
  host: string;
  port: number;
}

/** The local endpoint a DB client should connect to instead of the real host. */
export interface LocalEndpoint {
  host: string;
  port: number;
}

interface ActiveTunnel {
  client: SshClient;
  server: Server;
  endpoint: LocalEndpoint;
}

const CONNECT_TIMEOUT_MS = 15000;

/**
 * Manages SSH tunnels, one per profile. `open` connects to the bastion, starts
 * a `127.0.0.1:<ephemeral>` TCP server, and forwards every accepted socket to
 * the target through the SSH connection (`forwardOut`). The DB client then
 * connects to the returned local endpoint, unaware a bastion is in the path.
 *
 * Tunnels are keyed by profileId so `connect`/`disconnect` on the same profile
 * reuse / tear down the right one. `close` is idempotent.
 */
export class SshTunnel {
  private readonly tunnels = new Map<string, ActiveTunnel>();

  isOpen(profileId: string): boolean {
    return this.tunnels.has(profileId);
  }

  /**
   * Open (or reuse) a tunnel for `profileId` to `target`. Returns the local
   * endpoint the DB client should dial. Reuses an existing tunnel for the same
   * profile rather than stacking sockets.
   */
  async open(
    profileId: string,
    ssh: SshConfig,
    target: TunnelTarget,
  ): Promise<LocalEndpoint> {
    const existing = this.tunnels.get(profileId);
    if (existing) return existing.endpoint;

    const ssh2 = await loadSsh2();
    const config = await buildConnectConfig(ssh);
    const client = new ssh2.Client();

    await connectClient(client, config, ssh.host);

    const server = await startForwardServer(client, target);
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      client.end();
      throw new Error("Failed to allocate a local SSH-tunnel port.");
    }
    const endpoint: LocalEndpoint = { host: "127.0.0.1", port: address.port };

    // If the SSH connection drops underneath us, tear the local server down so
    // the DB client fails fast instead of hanging on a dead forward.
    client.on("close", () => {
      const tunnel = this.tunnels.get(profileId);
      if (tunnel && tunnel.client === client) {
        this.tunnels.delete(profileId);
        tunnel.server.close();
      }
    });

    this.tunnels.set(profileId, { client, server, endpoint });
    return endpoint;
  }

  /** Tear down the tunnel for `profileId`, if any. Idempotent. */
  async close(profileId: string): Promise<void> {
    const tunnel = this.tunnels.get(profileId);
    if (!tunnel) return;
    this.tunnels.delete(profileId);
    await new Promise<void>((resolve) => tunnel.server.close(() => resolve()));
    tunnel.client.end();
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)));
  }
}

async function buildConnectConfig(ssh: SshConfig): Promise<ConnectConfig> {
  const config: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    readyTimeout: CONNECT_TIMEOUT_MS,
  };
  if (ssh.auth.kind === "key") {
    if (!ssh.auth.privateKeyPath) {
      throw new Error("SSH key auth requires a private key path.");
    }
    try {
      config.privateKey = await readFile(ssh.auth.privateKeyPath);
    } catch (caught) {
      throw new Error(
        `Could not read SSH private key at ${ssh.auth.privateKeyPath}: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );
    }
    if (ssh.auth.passphrase) config.passphrase = ssh.auth.passphrase;
  } else if (ssh.auth.password) {
    config.password = ssh.auth.password;
  }
  return config;
}

function connectClient(
  client: SshClient,
  config: ConnectConfig,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onReady = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`SSH connection to ${host} failed: ${err.message}`));
    };
    client.once("ready", onReady);
    client.once("error", onError);
    client.connect(config);
  });
}

function startForwardServer(
  client: SshClient,
  target: TunnelTarget,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      client.forwardOut(
        "127.0.0.1",
        0,
        target.host,
        target.port,
        (err, channel) => {
          if (err) {
            socket.destroy();
            return;
          }
          socket.pipe(channel).pipe(socket);
          // Tear down both halves if either side errors so we don't leak the
          // forwarded channel on a broken DB socket.
          socket.on("error", () => channel.destroy());
          channel.on("error", () => socket.destroy());
        },
      );
    });
    server.once("error", (err) => reject(err));
    // Port 0 → OS picks a free ephemeral port; bind to loopback only.
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
