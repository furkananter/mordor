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
  // Each entry holds the in-flight (or settled) Promise<ActiveTunnel> rather
  // than the resolved tunnel: caching the Promise *before* awaiting it means
  // two concurrent opens for the same profileId reuse one connection instead
  // of racing past the map read and each leaking their own tunnel.
  private readonly tunnels = new Map<string, Promise<ActiveTunnel>>();

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
    if (existing) return (await existing).endpoint;

    // Cache the in-flight Promise immediately so a concurrent open() for the
    // same profile awaits this one instead of building a second tunnel. Drop
    // it on failure so a later open() can retry rather than reusing a rejection.
    const pending = this.buildTunnel(profileId, ssh, target);
    this.tunnels.set(profileId, pending);
    try {
      const tunnel = await pending;
      return tunnel.endpoint;
    } catch (caught) {
      if (this.tunnels.get(profileId) === pending) {
        this.tunnels.delete(profileId);
      }
      throw caught;
    }
  }

  private async buildTunnel(
    profileId: string,
    ssh: SshConfig,
    target: TunnelTarget,
  ): Promise<ActiveTunnel> {
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
    const tunnel: ActiveTunnel = { client, server, endpoint };

    // If the SSH connection drops underneath us, tear the local server down so
    // the DB client fails fast instead of hanging on a dead forward.
    client.on("close", () => {
      const entry = this.tunnels.get(profileId);
      if (entry === undefined) return;
      // Only evict our own entry: a re-open may have replaced it since.
      void entry.then(
        (active) => {
          if (active === tunnel && this.tunnels.get(profileId) === entry) {
            this.tunnels.delete(profileId);
            active.server.close();
          }
        },
        () => {},
      );
    });

    return tunnel;
  }

  /** Tear down the tunnel for `profileId`, if any. Idempotent. */
  async close(profileId: string): Promise<void> {
    const pending = this.tunnels.get(profileId);
    if (!pending) return;
    this.tunnels.delete(profileId);
    let tunnel: ActiveTunnel;
    try {
      tunnel = await pending;
    } catch {
      // The open never completed — nothing to tear down.
      return;
    }
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
