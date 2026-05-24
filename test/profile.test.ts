import { describe, expect, it } from "vitest";
import { createProfileFromDraft, secretKeyForProfile, validateStoredProfile } from "../src/core/config/profile";

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
});
