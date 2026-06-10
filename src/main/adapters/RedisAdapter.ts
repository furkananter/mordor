import type { Redis as RedisClient, default as RedisCtor } from "ioredis";
import { createConnection } from "node:net";

// ioredis is ~200 KB + pulls a chunk of node:tls/net wiring on require. Lazy
// so cold start doesn't pay the cost when no Redis profile is touched.
let redisCtorPromise: Promise<typeof RedisCtor> | undefined;
async function loadRedis(): Promise<typeof RedisCtor> {
  if (!redisCtorPromise) {
    redisCtorPromise = import("ioredis").then((m) => m.default ?? (m as unknown as typeof RedisCtor));
  }
  return redisCtorPromise;
}
import {
  ConnectionDraft,
  ConnectionProfile,
  ConnectionProfileWithPassword,
  isRedisProfile
} from "../../core/config/profile";
import {
  AdapterConnectResult,
  AdapterSchema,
  DatabaseAdapter,
  DetectedConnection
} from "../../core/db/types";
import {
  RedisCommandResult,
  RedisDbStat,
  RedisKeyEntry,
  RedisKeyValue,
  RedisScanResult
} from "../../core/ipc";
import type { ExportResult } from "../../core/export/types";
import { runRedisExport } from "./redis-exporter";

interface RedisSession {
  client: RedisClient;
  currentDb: number;
}

const LOCAL_REDIS_CANDIDATES = [
  { host: "127.0.0.1", port: 6379 },
  { host: "::1", port: 6379 }
];

const PROBE_TIMEOUT_MS = 600;

export class RedisAdapter implements DatabaseAdapter {
  readonly type = "redis" as const;

  private readonly sessions = new Map<string, RedisSession>();

  async connect(profile: ConnectionProfileWithPassword): Promise<AdapterConnectResult> {
    if (profile.type !== "redis") {
      throw new Error("RedisAdapter received non-Redis profile.");
    }

    const existing = this.sessions.get(profile.id);
    if (existing) return { schema: { kind: "redis" } };

    const Redis = await loadRedis();
    const client = new Redis({
      host: profile.host,
      port: profile.port,
      db: profile.db,
      username: profile.username,
      password: profile.password,
      tls: profile.useTls
        ? { rejectUnauthorized: profile.tlsRejectUnauthorized ?? true }
        : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 5000
    });

    try {
      await client.connect();
      await client.ping();
    } catch (caught) {
      client.disconnect();
      throw caught instanceof Error ? caught : new Error(String(caught));
    }

    this.sessions.set(profile.id, { client, currentDb: profile.db });
    return { schema: { kind: "redis" } };
  }

  async disconnect(profileId: string): Promise<void> {
    const session = this.sessions.get(profileId);
    if (!session) return;
    this.sessions.delete(profileId);
    try {
      await session.client.quit();
    } catch {
      session.client.disconnect();
    }
  }

  isConnected(profileId: string): boolean {
    const session = this.sessions.get(profileId);
    if (!session) return false;
    return session.client.status === "ready" || session.client.status === "connect";
  }

  getSchema(): AdapterSchema {
    return { kind: "redis" };
  }

  async detectLocal(existing: ConnectionProfile[]): Promise<DetectedConnection[]> {
    // Skip if any local Redis profile already exists (covers 127.0.0.1 OR ::1).
    const alreadySaved = existing.some(
      (profile) =>
        isRedisProfile(profile) &&
        profile.port === 6379 &&
        (profile.host === "127.0.0.1" || profile.host === "::1" || profile.host === "localhost")
    );
    if (alreadySaved) return [];

    // Probe candidates and create only ONE profile for the first that ACTUALLY speaks
    // Redis. A bare TCP connect is not enough — many things may listen on 6379
    // (proxies, half-open sockets, port-scan traps). Without a PING/+PONG verification
    // the user gets a ghost profile that throws EPIPE on every interaction.
    for (const candidate of LOCAL_REDIS_CANDIDATES) {
      const isRedis = await probeRedis(candidate.host, candidate.port, PROBE_TIMEOUT_MS);
      if (!isRedis) continue;
      const draft: ConnectionDraft = {
        type: "redis",
        name: `Local Redis (${candidate.host}:${candidate.port})`,
        host: candidate.host,
        port: String(candidate.port),
        db: "0",
        useTls: false
      };
      return [{ draft, notes: "Local Redis" }];
    }
    return [];
  }

  isLocalCandidate(profile: ConnectionProfile): boolean {
    if (!isRedisProfile(profile)) return false;
    return LOCAL_REDIS_CANDIDATES.some(
      (candidate) => candidate.host === profile.host && candidate.port === profile.port
    );
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.disconnect(id)));
  }

  // --- Redis-specific operations ---

  async dbStats(profileId: string): Promise<RedisDbStat[]> {
    const client = this.requireClient(profileId);
    const info = await client.info("keyspace");
    const stats: RedisDbStat[] = [];
    for (const line of info.split(/\r?\n/)) {
      const match = /^db(\d+):keys=(\d+)/.exec(line);
      if (match) {
        stats.push({ index: Number(match[1]), keys: Number(match[2]) });
      }
    }
    // ensure all 16 DBs surface even when empty
    for (let i = 0; i < 16; i += 1) {
      if (!stats.find((entry) => entry.index === i)) stats.push({ index: i, keys: 0 });
    }
    stats.sort((a, b) => a.index - b.index);
    return stats;
  }

  async scan(profileId: string, db: number, pattern: string, cursor: string): Promise<RedisScanResult> {
    const client = await this.useDb(profileId, db);
    const [nextCursor, rawKeys] = (await client.scan(
      cursor || "0",
      "MATCH",
      pattern || "*",
      "COUNT",
      200
    )) as [string, string[]];
    const keys: RedisKeyEntry[] = [];
    if (rawKeys.length > 0) {
      const pipeline = client.pipeline();
      for (const key of rawKeys) {
        pipeline.type(key);
        pipeline.ttl(key);
      }
      const results = (await pipeline.exec()) ?? [];
      for (let i = 0; i < rawKeys.length; i += 1) {
        const typeRes = results[i * 2];
        const ttlRes = results[i * 2 + 1];
        const type = typeRes && !typeRes[0] ? (typeRes[1] as string) : "none";
        const ttl = ttlRes && !ttlRes[0] ? (ttlRes[1] as number) : -1;
        keys.push({
          key: rawKeys[i]!,
          type: normalizeKeyType(type),
          ttl
        });
      }
    }
    return { cursor: nextCursor, keys };
  }

  async getKey(profileId: string, db: number, key: string): Promise<RedisKeyValue> {
    const client = await this.useDb(profileId, db);
    const type = normalizeKeyType(await client.type(key));
    const ttl = await client.ttl(key);
    if (type === "string") {
      const data = await client.get(key);
      return { key, type, ttl, value: { kind: "string", data: data ?? "" } };
    }
    if (type === "list") {
      const data = await client.lrange(key, 0, 199);
      return { key, type, ttl, value: { kind: "list", data } };
    }
    if (type === "set") {
      const data = await client.srandmember(key, 200);
      return { key, type, ttl, value: { kind: "set", data: data ?? [] } };
    }
    if (type === "zset") {
      const raw = await client.zrange(key, 0, 199, "WITHSCORES");
      const data: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < raw.length; i += 2) {
        data.push({ member: raw[i] ?? "", score: Number(raw[i + 1] ?? 0) });
      }
      return { key, type, ttl, value: { kind: "zset", data } };
    }
    if (type === "hash") {
      const raw = await client.hgetall(key);
      const data = Object.entries(raw).map(([field, value]) => ({ field, value }));
      return { key, type, ttl, value: { kind: "hash", data } };
    }
    if (type === "stream") {
      const raw = (await client.call("XRANGE", key, "-", "+", "COUNT", "100")) as Array<
        [string, string[]]
      >;
      const data = raw.map(([id, fields]) => {
        const parsed: Array<{ field: string; value: string }> = [];
        for (let i = 0; i < fields.length; i += 2) {
          parsed.push({ field: fields[i] ?? "", value: fields[i + 1] ?? "" });
        }
        return { id, fields: parsed };
      });
      return { key, type, ttl, value: { kind: "stream", data } };
    }
    return { key, type: "none", ttl, value: { kind: "none" } };
  }

  async deleteKey(profileId: string, db: number, key: string): Promise<void> {
    const client = await this.useDb(profileId, db);
    await client.del(key);
  }

  async setString(profileId: string, db: number, key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = await this.useDb(profileId, db);
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      await client.set(key, value, "EX", ttlSeconds);
    } else {
      await client.set(key, value);
    }
  }

  /** Export a single Redis key. `profileName` is woven into the folder slug. */
  async exportKey(
    profileId: string,
    profileName: string,
    db: number,
    key: string,
    outputDir: string,
  ): Promise<ExportResult> {
    const client = await this.useDb(profileId, db);
    const session = this.sessions.get(profileId)!;
    return runRedisExport({
      profileId,
      profileName,
      client,
      outputDir,
      db: session.currentDb,
      target: key,
      mode: "single-key",
      scopeLabel: `key ${key}`,
    });
  }

  /** Export keys matching a SCAN MATCH pattern (e.g. `user:*`). */
  async exportPattern(
    profileId: string,
    profileName: string,
    db: number,
    pattern: string,
    outputDir: string,
  ): Promise<ExportResult> {
    const client = await this.useDb(profileId, db);
    const session = this.sessions.get(profileId)!;
    return runRedisExport({
      profileId,
      profileName,
      client,
      outputDir,
      db: session.currentDb,
      target: pattern,
      mode: "pattern",
      scopeLabel: `pattern ${pattern}`,
    });
  }

  /** Export every key in the selected DB. */
  async exportAll(
    profileId: string,
    profileName: string,
    db: number,
    outputDir: string,
  ): Promise<ExportResult> {
    const client = await this.useDb(profileId, db);
    const session = this.sessions.get(profileId)!;
    return runRedisExport({
      profileId,
      profileName,
      client,
      outputDir,
      db: session.currentDb,
      target: "*",
      mode: "all",
      scopeLabel: `full DB ${db}`,
    });
  }

  async runCommand(profileId: string, db: number, command: string): Promise<RedisCommandResult> {
    const client = await this.useDb(profileId, db);
    const tokens = parseCommand(command);
    if (tokens.length === 0) return { ok: false, error: "Empty command." };
    const [name, ...args] = tokens;
    try {
      const result = await client.call(name!, ...args);
      return { ok: true, result: stringifyResult(result) };
    } catch (caught) {
      return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
    }
  }

  private requireClient(profileId: string): RedisClient {
    const session = this.sessions.get(profileId);
    if (!session) throw new Error(`Redis profile ${profileId} is not connected.`);
    return session.client;
  }

  private async useDb(profileId: string, db: number): Promise<RedisClient> {
    const session = this.sessions.get(profileId);
    if (!session) throw new Error(`Redis profile ${profileId} is not connected.`);
    if (session.currentDb !== db) {
      await session.client.select(db);
      session.currentDb = db;
    }
    return session.client;
  }
}

function normalizeKeyType(type: string): RedisKeyEntry["type"] {
  switch (type) {
    case "string":
    case "list":
    case "set":
    case "zset":
    case "hash":
    case "stream":
      return type;
    default:
      return "none";
  }
}

function parseCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && input[i + 1] === quote) {
        current += quote;
        i += 1;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function stringifyResult(value: unknown): string {
  if (value === null) return "(nil)";
  if (Array.isArray(value)) {
    return value.map((entry, idx) => `${idx + 1}) ${stringifyResult(entry)}`).join("\n");
  }
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Sends a real RESP `PING` and expects `+PONG`. Anything else (refused, timeout,
 * non-RESP response, peer closes early with EPIPE) → not Redis. This prevents the
 * adapter from creating ghost local profiles when something unrelated happens to
 * be listening on 6379.
 */
function probeRedis(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    let buffer = "";
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      // RESP inline command: "PING\r\n" — accepted by every supported Redis version.
      socket.write("PING\r\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.startsWith("+PONG")) finish(true);
      // First byte must be '+' (simple string) for a healthy Redis. Anything else is
      // not RESP — bail out fast instead of waiting for the full timeout.
      else if (buffer.length > 0 && buffer[0] !== "+") finish(false);
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}
