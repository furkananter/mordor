import type { SshConfig } from "../config/profile";

/**
 * Structural contract the DB services depend on to open an SSH tunnel without
 * importing the main-process `SshTunnel` implementation directly (keeps `core`
 * free of `node:net`/`ssh2` wiring). The concrete `SshTunnel` in
 * `src/main/ssh/SshTunnel.ts` satisfies this shape.
 */
export interface SshTunnelManager {
  open(
    profileId: string,
    ssh: SshConfig,
    target: { host: string; port: number },
  ): Promise<{ host: string; port: number }>;
  close(profileId: string): Promise<void>;
}
