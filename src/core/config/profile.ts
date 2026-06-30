// Use the global Web Crypto `randomUUID` instead of importing from `node:crypto`.
// This file is shared between main (Node) and renderer (Chromium), and Vite
// externalizes `node:*` modules — touching any export from `node:crypto` in the
// renderer throws at module-evaluation time. The global form works in both
// (Node 19+ and all modern Chromium) and keeps profile.ts safe to import from
// renderer code like ConnectionNode and WorkspaceHome.
function newProfileId(): string {
  return globalThis.crypto.randomUUID();
}

export type ProfileType = "cassandra" | "redis" | "postgres";

export type SshAuthKind = "password" | "key";

/**
 * Optional per-profile SSH tunnel. When present, the DB client connects to a
 * local forwarded port instead of the real host (see `SshTunnel`). The bastion
 * `password`/`passphrase` are SECRETS — they are stripped before the profile is
 * written to plaintext JSON and stored via the keychain (`SecretStore`), exactly
 * like the DB `password`. The persisted profile keeps only the non-secret shape
 * (host/port/username/auth.kind/privateKeyPath).
 */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: {
    kind: SshAuthKind;
    /** Secret — never persisted in plaintext profile JSON. */
    password?: string;
    /** Path to a private key file on disk (non-secret). */
    privateKeyPath?: string;
    /** Secret — never persisted in plaintext profile JSON. */
    passphrase?: string;
  };
}

interface BaseProfile {
  id: string;
  name: string;
  type: ProfileType;
  useTls: boolean;
  username?: string;
  ssh?: SshConfig;
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

/**
 * PostgreSQL connection. Each profile targets exactly one database — switching
 * DBs requires a different profile (this mirrors how libpq itself works and
 * keeps the schema sidebar deterministic). SSL is opt-in via `useTls` for the
 * basic case; the `sslMode` field carries the libpq-style strictness when the
 * user needs to override the default. `useTls=false` corresponds to `disable`.
 */
export interface PostgresProfile extends BaseProfile {
  type: "postgres";
  host: string;
  port: number;
  database: string;
  sslMode?: "require" | "verify-ca" | "verify-full";
}

export type ConnectionProfile = CassandraProfile | RedisProfile | PostgresProfile;

/**
 * String-valued draft for the optional SSH tunnel section of the connection
 * form. `enabled` lets the user toggle the whole section without losing the
 * typed values. Mirrors the other drafts (everything is a string the form
 * binds to; `createProfileFromDraft` parses/validates).
 */
export interface SshConnectionDraft {
  enabled: boolean;
  host: string;
  port?: string;
  username: string;
  authKind: SshAuthKind;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

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
  ssh?: SshConnectionDraft;
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
  ssh?: SshConnectionDraft;
}

export interface PostgresConnectionDraft {
  type: "postgres";
  name: string;
  host: string;
  port?: string;
  database: string;
  username?: string;
  password?: string;
  useTls: boolean;
  sslMode?: PostgresProfile["sslMode"];
  /** Pasted `postgres://...` URI. When present, overrides other fields on save. */
  connectionString?: string;
  ssh?: SshConnectionDraft;
}

export type ConnectionDraft =
  | CassandraConnectionDraft
  | RedisConnectionDraft
  | PostgresConnectionDraft;

export type ConnectionProfileWithPassword = ConnectionProfile & { password?: string };

export function isCassandraProfile(profile: ConnectionProfile): profile is CassandraProfile {
  return profile.type === "cassandra";
}

export function isRedisProfile(profile: ConnectionProfile): profile is RedisProfile {
  return profile.type === "redis";
}

export function isPostgresProfile(profile: ConnectionProfile): profile is PostgresProfile {
  return profile.type === "postgres";
}

export function validateStoredProfile(value: unknown): ConnectionProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConnectionProfile> & Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) return null;
  if (typeof candidate.useTls !== "boolean") return null;

  // Back-compat: old profiles without `type` are Cassandra. Newer profiles
  // (`redis`, `postgres`) are dispatched explicitly so the back-compat path
  // never accidentally swallows a future type as Cassandra.
  const rawType = candidate.type;
  const type: ProfileType =
    rawType === "redis" || rawType === "postgres" ? rawType : "cassandra";

  if (type === "cassandra") return validateCassandraStored(candidate);
  if (type === "redis") return validateRedisStored(candidate);
  return validatePostgresStored(candidate);
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
  const ssh = validateStoredSsh(candidate["ssh"]);
  if (ssh) profile.ssh = ssh;
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
  const ssh = validateStoredSsh(candidate["ssh"]);
  if (ssh) profile.ssh = ssh;
  return profile;
}

function validatePostgresStored(candidate: Record<string, unknown>): PostgresProfile | null {
  if (typeof candidate["host"] !== "string" || !candidate["host"].trim()) return null;
  if (typeof candidate["port"] !== "number") return null;
  if (typeof candidate["database"] !== "string" || !candidate["database"].trim()) return null;

  const profile: PostgresProfile = {
    id: String(candidate["id"]),
    name: String(candidate["name"]).trim(),
    type: "postgres",
    host: String(candidate["host"]).trim(),
    port: normalizePort(candidate["port"] as number),
    database: String(candidate["database"]).trim(),
    useTls: Boolean(candidate["useTls"])
  };

  const username = normalizeOptional(candidate["username"]);
  if (username) profile.username = username;
  const sslMode = candidate["sslMode"];
  if (sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full") {
    profile.sslMode = sslMode;
  }
  const ssh = validateStoredSsh(candidate["ssh"]);
  if (ssh) profile.ssh = ssh;
  return profile;
}

/**
 * Validate an stored `ssh` blob back into a `SshConfig`. Secrets
 * (`password`/`passphrase`) are NOT persisted in the profile JSON — they live in
 * the keychain — so this never reads them; the connect path re-attaches them
 * from the `SecretStore`. Returns `undefined` (not an error) when ssh is absent
 * or malformed, keeping old profiles back-compatible (absent ssh = direct
 * connect).
 */
export function validateStoredSsh(value: unknown): SshConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const host = normalizeOptional(candidate["host"]);
  if (!host) return undefined;
  if (typeof candidate["port"] !== "number") return undefined;
  const username = normalizeOptional(candidate["username"]);
  if (!username) return undefined;
  const auth = candidate["auth"];
  if (!auth || typeof auth !== "object") return undefined;
  const authCandidate = auth as Record<string, unknown>;
  const kind: SshAuthKind = authCandidate["kind"] === "key" ? "key" : "password";

  const ssh: SshConfig = {
    host,
    port: normalizePort(candidate["port"] as number),
    username,
    auth: { kind },
  };
  const privateKeyPath = normalizeOptional(authCandidate["privateKeyPath"]);
  if (privateKeyPath) ssh.auth.privateKeyPath = privateKeyPath;
  return ssh;
}

export function createProfileFromDraft(draft: ConnectionDraft): ConnectionProfileWithPassword {
  const name = draft.name.trim();
  if (!name) throw new Error("Connection name is required.");

  if (draft.type === "redis") {
    const host = draft.host.trim();
    if (!host) throw new Error("Host is required.");
    const profile: ConnectionProfileWithPassword = {
      id: newProfileId(),
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
    const ssh = buildSshConfigFromDraft(draft.ssh);
    if (ssh) profile.ssh = ssh;
    return profile;
  }

  if (draft.type === "postgres") {
    // Connection-string takes precedence: if the user pasted a URI we honor it
    // and ignore the individual fields, because mixing the two silently almost
    // always confuses people ("I changed the port but it kept using the URI").
    const parsed = draft.connectionString?.trim()
      ? parsePostgresConnectionString(draft.connectionString.trim())
      : undefined;
    const host = (parsed?.host ?? draft.host).trim();
    if (!host) throw new Error("Host is required.");
    const database = (parsed?.database ?? draft.database).trim();
    if (!database) throw new Error("Database name is required.");

    const profile: ConnectionProfileWithPassword = {
      id: newProfileId(),
      name,
      type: "postgres",
      host,
      port: parsed?.port ?? parsePort(draft.port, 5432),
      database,
      useTls: parsed?.useTls ?? draft.useTls
    };
    // Username: if the user cleared the field, fall back to "postgres" instead
    // of letting pg drop to `process.env.USER` (the macOS account name).
    // That fallback is what makes "I cleared the username and now it tries to
    // authenticate as `furkan`" surprising — Mordor is opinionated here. To
    // override (e.g. peer auth on brew install), the user explicitly types
    // their OS username; we never *invent* it on their behalf.
    const username = normalizeOptional(parsed?.username ?? draft.username) ?? "postgres";
    profile.username = username;
    const password = normalizeOptional(parsed?.password ?? draft.password);
    if (password) profile.password = password;
    const sslMode = parsed?.sslMode ?? draft.sslMode;
    if (sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full") {
      profile.sslMode = sslMode;
    }
    const ssh = buildSshConfigFromDraft(draft.ssh);
    if (ssh) profile.ssh = ssh;
    return profile;
  }

  const contactPoints = parseContactPoints(draft.contactPoints);
  if (contactPoints.length === 0) throw new Error("At least one contact point is required.");

  const profile: ConnectionProfileWithPassword = {
    id: newProfileId(),
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
  const ssh = buildSshConfigFromDraft(draft.ssh);
  if (ssh) profile.ssh = ssh;
  return profile;
}

/**
 * Turn the string-valued SSH draft into a validated `SshConfig`. Returns
 * `undefined` when the section is disabled or absent (→ direct connect, the
 * back-compatible default). The returned config CAN carry the
 * `password`/`passphrase` secrets — callers persisting the profile must strip
 * them into the `SecretStore` (see `ProfileStore`).
 */
export function buildSshConfigFromDraft(draft: SshConnectionDraft | undefined): SshConfig | undefined {
  if (!draft || !draft.enabled) return undefined;
  const host = draft.host.trim();
  if (!host) throw new Error("SSH host is required when the tunnel is enabled.");
  const username = draft.username.trim();
  if (!username) throw new Error("SSH username is required when the tunnel is enabled.");
  const kind: SshAuthKind = draft.authKind === "key" ? "key" : "password";

  const ssh: SshConfig = {
    host,
    port: parsePort(draft.port, 22),
    username,
    auth: { kind },
  };
  if (kind === "key") {
    const privateKeyPath = normalizeOptional(draft.privateKeyPath);
    if (!privateKeyPath) throw new Error("A private key path is required for SSH key auth.");
    ssh.auth.privateKeyPath = privateKeyPath;
    const passphrase = normalizeOptional(draft.passphrase);
    if (passphrase) ssh.auth.passphrase = passphrase;
  } else {
    const password = normalizeOptional(draft.password);
    if (password) ssh.auth.password = password;
  }
  return ssh;
}

interface ParsedPostgresUri {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  useTls?: boolean;
  sslMode?: PostgresProfile["sslMode"];
}

/**
 * Best-effort `postgres://[user[:pass]@]host[:port]/database?sslmode=…` parser.
 * Falls back gracefully when fields are missing — connection-string pasting is
 * a convenience, not a validation gate, and the form re-validates downstream.
 */
function parsePostgresConnectionString(input: string): ParsedPostgresUri | undefined {
  try {
    // Normalize `postgresql://` to `postgres://` so URL() recognizes the scheme.
    const normalized = input.replace(/^postgresql:\/\//i, "postgres://");
    const url = new URL(normalized);
    if (url.protocol !== "postgres:") return undefined;
    const parsed: ParsedPostgresUri = {};
    if (url.hostname) parsed.host = decodeURIComponent(url.hostname);
    if (url.port) {
      const port = Number.parseInt(url.port, 10);
      if (Number.isInteger(port) && port > 0) parsed.port = port;
    }
    const pathDb = url.pathname.replace(/^\//, "");
    if (pathDb) parsed.database = decodeURIComponent(pathDb);
    if (url.username) parsed.username = decodeURIComponent(url.username);
    if (url.password) parsed.password = decodeURIComponent(url.password);
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode === "disable") parsed.useTls = false;
    else if (sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full") {
      parsed.useTls = true;
      parsed.sslMode = sslmode;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function secretKeyForProfile(profileId: string): string {
  return `connection:${profileId}:password`;
}

export function secretKeyForSshPassword(profileId: string): string {
  return `connection:${profileId}:ssh-password`;
}

export function secretKeyForSshPassphrase(profileId: string): string {
  return `connection:${profileId}:ssh-passphrase`;
}

export function profileAddress(profile: ConnectionProfile): string {
  if (profile.type === "redis") return `${profile.host}:${profile.port}`;
  if (profile.type === "postgres") return `${profile.host}:${profile.port}/${profile.database}`;
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
