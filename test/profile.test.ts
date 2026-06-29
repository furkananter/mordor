import { describe, expect, it } from "vitest";
import {
  createProfileFromDraft,
  secretKeyForProfile,
  secretKeyForSshPassphrase,
  secretKeyForSshPassword,
  validateStoredProfile,
  validateStoredSsh
} from "../src/core/config/profile";

describe("connection profile helpers", () => {
  it("normalizes a local Cassandra draft", () => {
    const profile = createProfileFromDraft({
      type: "cassandra",
      name: " Local ",
      contactPoints: "127.0.0.1, localhost ",
      port: "",
      localDataCenter: "",
      keyspace: " app ",
      username: "",
      password: "",
      useTls: false
    });

    expect(profile.name).toBe("Local");
    expect(profile.type).toBe("cassandra");
    if (profile.type !== "cassandra") throw new Error("expected cassandra");
    expect(profile.contactPoints).toEqual(["127.0.0.1", "localhost"]);
    expect(profile.port).toBe(9042);
    expect(profile.localDataCenter).toBe("datacenter1");
    expect(profile.keyspace).toBe("app");
    expect(profile.username).toBeUndefined();
  });

  it("rejects invalid ports", () => {
    expect(() =>
      createProfileFromDraft({
        type: "cassandra",
        name: "Remote",
        contactPoints: "db.example.com",
        port: "70000",
        useTls: true
      })
    ).toThrow("Port must be a number between 1 and 65535.");
  });

  it("creates a Redis draft with defaults", () => {
    const profile = createProfileFromDraft({
      type: "redis",
      name: "Cache",
      host: "127.0.0.1",
      useTls: false
    });
    expect(profile.type).toBe("redis");
    if (profile.type !== "redis") throw new Error("expected redis");
    expect(profile.host).toBe("127.0.0.1");
    expect(profile.port).toBe(6379);
    expect(profile.db).toBe(0);
  });

  it("drops invalid stored profile values", () => {
    expect(validateStoredProfile({ name: "missing id" })).toBeNull();
  });

  it("uses a stable secret key namespace", () => {
    expect(secretKeyForProfile("abc")).toBe("connection:abc:password");
  });

  it("uses stable ssh secret key namespaces", () => {
    expect(secretKeyForSshPassword("abc")).toBe("connection:abc:ssh-password");
    expect(secretKeyForSshPassphrase("abc")).toBe("connection:abc:ssh-passphrase");
  });
});

describe("ssh tunnel config", () => {
  it("leaves ssh undefined when the draft section is disabled", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "App",
      host: "db.internal",
      database: "app",
      useTls: false,
      ssh: {
        enabled: false,
        host: "bastion.example.com",
        username: "deploy",
        authKind: "password"
      }
    });
    expect(profile.ssh).toBeUndefined();
  });

  it("builds a password-auth ssh config and carries the secret on the draft result", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "App",
      host: "db.internal",
      database: "app",
      useTls: false,
      ssh: {
        enabled: true,
        host: "bastion.example.com",
        port: "2222",
        username: "deploy",
        authKind: "password",
        password: "s3cret"
      }
    });
    expect(profile.ssh).toEqual({
      host: "bastion.example.com",
      port: 2222,
      username: "deploy",
      auth: { kind: "password", password: "s3cret" }
    });
  });

  it("builds a key-auth ssh config with an optional passphrase", () => {
    const profile = createProfileFromDraft({
      type: "cassandra",
      name: "C",
      contactPoints: "db.internal",
      useTls: false,
      ssh: {
        enabled: true,
        host: "bastion.example.com",
        username: "deploy",
        authKind: "key",
        privateKeyPath: "/home/user/.ssh/id_ed25519",
        passphrase: "unlock"
      }
    });
    expect(profile.ssh).toEqual({
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      auth: {
        kind: "key",
        privateKeyPath: "/home/user/.ssh/id_ed25519",
        passphrase: "unlock"
      }
    });
  });

  it("rejects key auth without a private key path", () => {
    expect(() =>
      createProfileFromDraft({
        type: "redis",
        name: "Cache",
        host: "127.0.0.1",
        useTls: false,
        ssh: {
          enabled: true,
          host: "bastion.example.com",
          username: "deploy",
          authKind: "key"
        }
      })
    ).toThrow("A private key path is required for SSH key auth.");
  });

  it("requires host and username when the tunnel is enabled", () => {
    expect(() =>
      createProfileFromDraft({
        type: "redis",
        name: "Cache",
        host: "127.0.0.1",
        useTls: false,
        ssh: { enabled: true, host: "", username: "deploy", authKind: "password" }
      })
    ).toThrow("SSH host is required when the tunnel is enabled.");
  });

  it("validates a stored ssh blob, ignoring any persisted secrets", () => {
    const ssh = validateStoredSsh({
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      auth: { kind: "key", privateKeyPath: "/k", password: "leaked", passphrase: "leaked" }
    });
    expect(ssh).toEqual({
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      auth: { kind: "key", privateKeyPath: "/k" }
    });
  });

  it("round-trips ssh through validateStoredProfile (without secrets)", () => {
    const created = createProfileFromDraft({
      type: "postgres",
      name: "App",
      host: "db.internal",
      database: "app",
      useTls: false,
      ssh: {
        enabled: true,
        host: "bastion.example.com",
        username: "deploy",
        authKind: "password",
        password: "s3cret"
      }
    });
    // Simulate the persistence path: secrets are stripped before write.
    const { password: _pw, ...persistable } = created;
    const stripped = {
      ...persistable,
      ssh: persistable.ssh
        ? { ...persistable.ssh, auth: { kind: persistable.ssh.auth.kind } }
        : undefined
    };
    const restored = validateStoredProfile(JSON.parse(JSON.stringify(stripped)));
    expect(restored?.ssh).toEqual({
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      auth: { kind: "password" }
    });
  });

  it("returns undefined for an absent or malformed ssh blob", () => {
    expect(validateStoredSsh(undefined)).toBeUndefined();
    expect(validateStoredSsh({ host: "x" })).toBeUndefined();
    expect(validateStoredSsh({ host: "x", port: 22, username: "u" })).toBeUndefined();
  });
});
