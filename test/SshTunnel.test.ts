import { connect, type Socket } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SshConfig } from "../src/core/config/profile";

// A controllable fake of the ssh2 `Client`. `forwardOut` hands back a
// PassThrough that the test inspects to assert bytes flow through the tunnel.
class FakeSshClient {
  readyListeners: Array<() => void> = [];
  errorListeners: Array<(err: Error) => void> = [];
  closeListeners: Array<() => void> = [];
  channels: PassThrough[] = [];
  connectConfig: unknown;
  failConnectWith: Error | undefined;
  ended = false;

  connect(config: unknown): this {
    this.connectConfig = config;
    queueMicrotask(() => {
      if (this.failConnectWith) {
        for (const l of this.errorListeners) l(this.failConnectWith);
      } else {
        for (const l of this.readyListeners) l();
      }
    });
    return this;
  }
  on(event: string, listener: (...args: never[]) => void): this {
    return this.once(event, listener);
  }
  once(event: string, listener: (...args: never[]) => void): this {
    if (event === "ready") this.readyListeners.push(listener as () => void);
    if (event === "error") this.errorListeners.push(listener as (e: Error) => void);
    if (event === "close") this.closeListeners.push(listener as () => void);
    return this;
  }
  forwardOut(
    _sIP: string,
    _sPort: number,
    _dIP: string,
    _dPort: number,
    cb: (err: Error | undefined, channel: PassThrough) => void
  ): this {
    const channel = new PassThrough();
    this.channels.push(channel);
    cb(undefined, channel);
    return this;
  }
  end(): this {
    this.ended = true;
    for (const l of this.closeListeners) l();
    return this;
  }
}

let lastClient: FakeSshClient | undefined;
let nextFailure: Error | undefined;

vi.mock("ssh2", () => ({
  Client: class {
    constructor() {
      lastClient = new FakeSshClient();
      if (nextFailure) lastClient.failConnectWith = nextFailure;
      return lastClient as unknown as object;
    }
  }
}));

// Import after the mock is registered.
const { SshTunnel } = await import("../src/main/ssh/SshTunnel");

const passwordSsh: SshConfig = {
  host: "bastion.example.com",
  port: 22,
  username: "deploy",
  auth: { kind: "password", password: "s3cret" }
};

afterEach(() => {
  lastClient = undefined;
  nextFailure = undefined;
});

describe("SshTunnel", () => {
  it("opens a loopback port and forwards bytes through the ssh channel", async () => {
    const tunnel = new SshTunnel();
    const endpoint = await tunnel.open("p1", passwordSsh, { host: "db.internal", port: 5432 });

    expect(endpoint.host).toBe("127.0.0.1");
    expect(endpoint.port).toBeGreaterThan(0);
    expect(lastClient?.connectConfig).toMatchObject({
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      password: "s3cret"
    });

    // Connect to the local endpoint; bytes written should reach the forwarded channel.
    const socket: Socket = connect(endpoint.port, endpoint.host);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const channel = lastClient!.channels[0]!;
    const received = new Promise<string>((resolve) => {
      channel.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
    });
    socket.write("hello-db");
    expect(await received).toBe("hello-db");

    socket.destroy();
    await tunnel.close("p1");
    expect(lastClient?.ended).toBe(true);
  });

  it("reuses an existing tunnel for the same profile", async () => {
    const tunnel = new SshTunnel();
    const first = await tunnel.open("p1", passwordSsh, { host: "db", port: 1 });
    const firstClient = lastClient;
    const second = await tunnel.open("p1", passwordSsh, { host: "db", port: 1 });
    expect(second).toEqual(first);
    // No second client was constructed.
    expect(lastClient).toBe(firstClient);
    await tunnel.close("p1");
  });

  it("close is idempotent for an unknown profile", async () => {
    const tunnel = new SshTunnel();
    await expect(tunnel.close("missing")).resolves.toBeUndefined();
  });

  it("surfaces a clear error when the ssh connection fails", async () => {
    nextFailure = new Error("auth failed");
    const tunnel = new SshTunnel();
    await expect(
      tunnel.open("p2", passwordSsh, { host: "db", port: 1 })
    ).rejects.toThrow("SSH connection to bastion.example.com failed: auth failed");
    expect(tunnel.isOpen("p2")).toBe(false);
  });
});
