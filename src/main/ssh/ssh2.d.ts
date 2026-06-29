// Minimal ambient declaration for the parts of `ssh2` that `SshTunnel` uses.
//
// `ssh2` is a runtime dependency (see package.json) but is loaded lazily via a
// dynamic `import("ssh2")` so it never enters the cold-start path. We ship this
// trimmed type surface instead of depending on `@types/ssh2` to keep the
// type-check self-contained — only the handful of members the tunnel touches
// are declared. The real module provides the implementation at runtime.
declare module "ssh2" {
  import type { Duplex } from "node:stream";

  export interface ConnectConfig {
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: Buffer | string;
    passphrase?: string;
    readyTimeout?: number;
  }

  type ForwardOutCallback = (err: Error | undefined, channel: Duplex) => void;

  export class Client {
    connect(config: ConnectConfig): this;
    on(event: "ready", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    once(event: "ready", listener: () => void): this;
    once(event: "error", listener: (err: Error) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    forwardOut(
      srcIP: string,
      srcPort: number,
      dstIP: string,
      dstPort: number,
      callback: ForwardOutCallback,
    ): this;
    end(): this;
  }
}
