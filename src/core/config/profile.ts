import { randomUUID } from "node:crypto";

export type ProfileType = "cassandra" | "redis";

interface BaseProfile {
  id: string;
  name: string;
  type: ProfileType;
  useTls: boolean;
  username?: string;
}

export interface CassandraProfile extends BaseProfile {
  type: "cassandra";
  contactPoints: string[];
  port: number;
  localDataCenter: string;
  keyspace?: string;
  migrationsFolder?: string;
  migrationsKeyspace?: string;
}

export interface RedisProfile extends BaseProfile {
  type: "redis";
  host: string;
  port: number;
  db: number;
  tlsRejectUnauthorized?: boolean;
}

export type ConnectionProfile = CassandraProfile | RedisProfile;

export interface CassandraConnectionDraft {
  type: "cassandra";
  name: string;
  contactPoints: string;
  port?: string;
  localDataCenter?: string;
  keyspace?: string;
  username?: string;
  password?: string;
  useTls: boolean;
  migrationsFolder?: string;
  migrationsKeyspace?: string;
}

export interface RedisConnectionDraft {
  type: "redis";
  name: string;
  host: string;
  port?: string;
  db?: string;
  username?: string;
  password?: string;
  useTls: boolean;
}

export type ConnectionDraft = CassandraConnectionDraft | RedisConnectionDraft;

export type ConnectionProfileWithPassword = ConnectionProfile & { password?: string };

export function isCassandraProfile(profile: ConnectionProfile): profile is CassandraProfile {
  return profile.type === "cassandra";
}

export function isRedisProfile(profile: ConnectionProfile): profile is RedisProfile {
  return profile.type === "redis";
}

export function validateStoredProfile(value: unknown): ConnectionProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConnectionProfile> & Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  if (typeof candidate.useTls !== "boolean") return null;

  // Back-compat: old profiles without `type` are Cassandra
  const type: ProfileType = candidate.type === "redis" ? "redis" : "cassandra";

  if (type === "cassandra") return validateCassandraStored(candidate);
  return validateRedisStored(candidate);
}

function validateCassandraStored(candidate: Record<string, unknown>): CassandraProfile | null {
  if (!Array.isArray(candidate["contactPoints"])) return null;
  if (typeof candidate["port"] !== "number") return null;
  if (typeof candidate["localDataCenter"] !== "string") return null;

  const contactPoints = (candidate["contactPoints"] as unknown[])
    .filter((point): point is string => typeof point === "string")
    .map((point) => point.trim())
    .filter(Boolean);
  if (contactPoints.length === 0) return null;

  const profile: CassandraProfile = {
    id: String(candidate["id"]),
    name: String(candidate["name"]).trim(),
    type: "cassandra",
    contactPoints,
    port: normalizePort(candidate["port"] as number),
    localDataCenter: String(candidate["localDataCenter"]).trim() || "datacenter1",
    useTls: Boolean(candidate["useTls"])
  };

  const keyspace = normalizeOptional(candidate["keyspace"]);
  if (keyspace) profile.keyspace = keyspace;
  const username = normalizeOptional(candidate["username"]);
  if (username) profile.username = username;
  const migrationsFolder = normalizeOptional(candidate["migrationsFolder"]);
  if (migrationsFolder) profile.migrationsFolder = migrationsFolder;
  const migrationsKeyspace = normalizeOptional(candidate["migrationsKeyspace"]);
  if (migrationsKeyspace) profile.migrationsKeyspace = migrationsKeyspace;
  return profile;
}

function validateRedisStored(candidate: Record<string, unknown>): RedisProfile | null {
  if (typeof candidate["host"] !== "string" || !candidate["host"].trim()) return null;
  if (typeof candidate["port"] !== "number") return null;

  const profile: RedisProfile = {
    id: String(candidate["id"]),
    name: String(candidate["name"]).trim(),
    type: "redis",
    host: String(candidate["host"]).trim(),
    port: normalizePort(candidate["port"] as number),
    db: typeof candidate["db"] === "number" ? Math.max(0, Math.min(15, Math.floor(candidate["db"] as number))) : 0,
    useTls: Boolean(candidate["useTls"])
  };

  const username = normalizeOptional(candidate["username"]);
  if (username) profile.username = username;
  if (typeof candidate["tlsRejectUnauthorized"] === "boolean") {
    profile.tlsRejectUnauthorized = candidate["tlsRejectUnauthorized"] as boolean;
  }
  return profile;
}

export function createProfileFromDraft(draft: ConnectionDraft): ConnectionProfileWithPassword {
  const name = draft.name.trim();
  if (!name) throw new Error("Connection name is required.");

  if (draft.type === "redis") {
    const host = draft.host.trim();
    if (!host) throw new Error("Host is required.");
    const profile: ConnectionProfileWithPassword = {
      id: randomUUID(),
      name,
      type: "redis",
      host,
      port: parsePort(draft.port, 6379),
      db: parseDb(draft.db),
      useTls: draft.useTls
    };
    const username = normalizeOptional(draft.username);
    if (username) profile.username = username;
    const password = normalizeOptional(draft.password);
    if (password) profile.password = password;
    return profile;
  }

  const contactPoints = parseContactPoints(draft.contactPoints);
  if (contactPoints.length === 0) throw new Error("At least one contact point is required.");

  const profile: ConnectionProfileWithPassword = {
    id: randomUUID(),
    name,
    type: "cassandra",
    contactPoints,
    port: parsePort(draft.port, 9042),
    localDataCenter: normalizeOptional(draft.localDataCenter) ?? "datacenter1",
    useTls: draft.useTls
  };
  const keyspace = normalizeOptional(draft.keyspace);
  if (keyspace) profile.keyspace = keyspace;
  const username = normalizeOptional(draft.username);
  if (username) profile.username = username;
  const password = normalizeOptional(draft.password);
  if (password) profile.password = password;
  const migrationsFolder = normalizeOptional(draft.migrationsFolder);
  if (migrationsFolder) profile.migrationsFolder = migrationsFolder;
  const migrationsKeyspace = normalizeOptional(draft.migrationsKeyspace);
  if (migrationsKeyspace) profile.migrationsKeyspace = migrationsKeyspace;
  return profile;
}

export function secretKeyForProfile(profileId: string): string {
  return `connection:${profileId}:password`;
}

export function profileAddress(profile: ConnectionProfile): string {
  if (profile.type === "redis") return `${profile.host}:${profile.port}`;
  return `${profile.contactPoints.join(", ")}:${profile.port}`;
}

function parseContactPoints(value: string): string[] {
  return value.split(",").map((point) => point.trim()).filter(Boolean);
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const port = Number.parseInt(value, 10);
  return normalizePort(port);
}

function parseDb(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const db = Number.parseInt(value, 10);
  if (!Number.isInteger(db) || db < 0 || db > 15) {
    throw new Error("Database index must be 0-15.");
  }
  return db;
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be a number between 1 and 65535.");
  }
  return port;
}

function normalizeOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
