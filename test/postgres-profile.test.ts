import { describe, expect, it } from "vitest";
import {
  createProfileFromDraft,
  isPostgresProfile,
  profileAddress,
  validateStoredProfile,
} from "../src/core/config/profile";

describe("postgres profile", () => {
  it("creates a postgres profile from a draft", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "Local DB",
      host: "127.0.0.1",
      port: "5432",
      database: "app",
      username: "postgres",
      password: "secret",
      useTls: false,
    });
    expect(profile.type).toBe("postgres");
    if (profile.type !== "postgres") throw new Error("type narrow failed");
    expect(profile.host).toBe("127.0.0.1");
    expect(profile.port).toBe(5432);
    expect(profile.database).toBe("app");
    expect(profile.username).toBe("postgres");
    expect((profile as { password?: string }).password).toBe("secret");
  });

  it("parses a connection string and prefers it over per-field values", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "Cloud DB",
      // These per-field values should be IGNORED — the connection string wins.
      host: "ignored.example.com",
      port: "1111",
      database: "ignored",
      username: "ignored",
      password: "ignored",
      useTls: false,
      connectionString: "postgres://app%5fuser:p%40ss@db.acme.io:6432/prod?sslmode=verify-full",
    });
    if (profile.type !== "postgres") throw new Error("type narrow failed");
    expect(profile.host).toBe("db.acme.io");
    expect(profile.port).toBe(6432);
    expect(profile.database).toBe("prod");
    expect(profile.username).toBe("app_user");
    expect((profile as { password?: string }).password).toBe("p@ss");
    expect(profile.useTls).toBe(true);
    expect(profile.sslMode).toBe("verify-full");
  });

  it("accepts postgresql:// scheme equally", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "Alt scheme",
      host: "x",
      port: "5432",
      database: "x",
      useTls: false,
      connectionString: "postgresql://u:p@h:5433/d",
    });
    if (profile.type !== "postgres") throw new Error("type narrow failed");
    expect(profile.host).toBe("h");
    expect(profile.port).toBe(5433);
  });

  it("falls back to per-field values when connection string is invalid", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "Bad URI",
      host: "fallback.example.com",
      port: "5555",
      database: "fb",
      useTls: false,
      connectionString: "not a uri",
    });
    if (profile.type !== "postgres") throw new Error("type narrow failed");
    expect(profile.host).toBe("fallback.example.com");
    expect(profile.port).toBe(5555);
    expect(profile.database).toBe("fb");
  });

  it("round-trips through validateStoredProfile", () => {
    const created = createProfileFromDraft({
      type: "postgres",
      name: "Local",
      host: "h",
      port: "5432",
      database: "d",
      useTls: true,
      sslMode: "require",
    });
    // Strip password (we don't persist it via store); validateStoredProfile
    // runs over the JSON shape the ProfileStore writes to disk.
    const { password: _password, ...persisted } = created as unknown as {
      password?: string;
    } & Record<string, unknown>;
    void _password;
    const reloaded = validateStoredProfile(persisted);
    expect(reloaded).not.toBeNull();
    if (!reloaded || !isPostgresProfile(reloaded)) throw new Error("not a postgres profile");
    expect(reloaded.host).toBe("h");
    expect(reloaded.database).toBe("d");
    expect(reloaded.useTls).toBe(true);
    expect(reloaded.sslMode).toBe("require");
  });

  it("renders host:port/database as the profile address", () => {
    const profile = createProfileFromDraft({
      type: "postgres",
      name: "L",
      host: "127.0.0.1",
      port: "5432",
      database: "app",
      useTls: false,
    });
    expect(profileAddress(profile)).toBe("127.0.0.1:5432/app");
  });
});
