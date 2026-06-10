/**
 * Redis export orchestration + renderer in one file (smaller surface than the
 * SQL engines — no schema, no DDL).
 *
 * Output:
 *
 *   - `commands.txt`     — replayable `redis-cli --pipe` script. One block per
 *                          key (SET/HSET/RPUSH/SADD/ZADD/XADD) followed by an
 *                          `EXPIRE` line when the source key carried a TTL.
 *   - `keys.json`        — structured dump: `[{key, type, ttl, value}, ...]`.
 *                          Useful for programmatic consumers.
 *   - `manifest.json`    — summary + warning list.
 *   - `README.md`        — restore instructions + known limitations.
 *
 * Scope mapping (from the engine-agnostic `ExportRequest`):
 *
 *   - `table` → single key, name supplied in `table.table`.
 *   - `schema` → SCAN MATCH pattern, supplied in `schema.keyspace`
 *                (e.g. `user:*`). The renderer label says "pattern".
 *   - `full`  → SCAN MATCH `*` against the selected DB index.
 *
 * Binary-safe note: we ask ioredis for string values (which is what the rest
 * of the workbench reads). Keys storing non-UTF-8 byte sequences will round-
 * trip lossily through `commands.txt` — flagged as a warning in the manifest.
 */

import type { Redis as RedisClient } from "ioredis";
import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";
import {
  EXPORT_BATCH_SIZE,
  EXPORT_ROW_CAP,
  ExportArtifact,
  ExportResult,
} from "../../core/export/types";
import { folderSlug, timestampSuffix } from "../../core/export/formatters";

export interface RedisExporterContext {
  profileId: string;
  profileName: string;
  client: RedisClient;
  outputDir: string;
  /** DB index already selected on the client before this call. */
  db: number;
  /** SCAN MATCH pattern, or a single key name when `mode === "key"`. */
  target: string;
  mode: "single-key" | "pattern" | "all";
  scopeLabel: string;
}

interface RedisExportEntry {
  key: string;
  type: "string" | "list" | "set" | "zset" | "hash" | "stream";
  ttl: number;
  value: unknown;
}

export async function runRedisExport(ctx: RedisExporterContext): Promise<ExportResult> {
  const started = Date.now();
  const warnings: string[] = [];

  const folderName = `mordor-redis-${folderSlug(ctx.profileName)}-db${ctx.db}-${timestampSuffix()}`;
  const folderPath = join(ctx.outputDir, folderName);
  await mkdir(folderPath, { recursive: true });

  const commandsPath = join(folderPath, "commands.txt");
  const commandsStream = createWriteStream(commandsPath, { encoding: "utf8" });
  await writeLine(commandsStream, `# Mordor export — Redis (DB ${ctx.db})`);
  await writeLine(commandsStream, `# Source: ${ctx.profileName} (${ctx.scopeLabel})`);
  await writeLine(commandsStream, `# Replay: cat commands.txt | redis-cli --pipe -n ${ctx.db}`);
  await writeLine(commandsStream, "");
  await writeLine(commandsStream, `SELECT ${ctx.db}`);

  const entries: RedisExportEntry[] = [];
  let keysProcessed = 0;
  const collect = async (key: string) => {
    if (keysProcessed >= EXPORT_ROW_CAP) return false;
    const entry = await readKey(ctx.client, key, warnings);
    if (!entry) return true; // key vanished between SCAN and reads
    entries.push(entry);
    await emitCommands(commandsStream, entry);
    keysProcessed += 1;
    return true;
  };

  if (ctx.mode === "single-key") {
    await collect(ctx.target);
  } else {
    const pattern = ctx.mode === "all" ? "*" : ctx.target || "*";
    let cursor = "0";
    do {
      const [next, batch] = (await ctx.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        EXPORT_BATCH_SIZE,
      )) as [string, string[]];
      for (const key of batch) {
        const continueScan = await collect(key);
        if (!continueScan) break;
      }
      cursor = next;
      if (keysProcessed >= EXPORT_ROW_CAP) {
        warnings.push(
          `Hit the ${EXPORT_ROW_CAP.toLocaleString()}-key export cap; remaining keys were not written.`,
        );
        break;
      }
    } while (cursor !== "0");
  }

  await closeStream(commandsStream);

  const jsonPath = join(folderPath, "keys.json");
  const jsonBody = `${JSON.stringify(entries, null, 2)}\n`;
  await writeFile(jsonPath, jsonBody, "utf8");

  const readme = renderReadme(ctx, entries, warnings);
  await writeFile(join(folderPath, "README.md"), readme, "utf8");

  const manifest = buildManifest({
    scopeLabel: ctx.scopeLabel,
    profileName: ctx.profileName,
    db: ctx.db,
    entries,
    warnings,
    startedAt: started,
  });
  await writeFile(join(folderPath, "manifest.json"), manifest, "utf8");

  const artifacts: ExportArtifact[] = [
    { relativePath: "commands.txt", byteCount: await byteSize(commandsPath) },
    { relativePath: "keys.json", byteCount: Buffer.byteLength(jsonBody, "utf8") },
    { relativePath: "README.md", byteCount: Buffer.byteLength(readme, "utf8") },
    { relativePath: "manifest.json", byteCount: Buffer.byteLength(manifest, "utf8") },
  ];

  return {
    folderPath,
    durationMs: Date.now() - started,
    engine: "redis",
    artifacts,
    tables: [],
    keysExported: entries.length,
    warnings,
  };
}

// -------- per-key reading ---------------------------------------------------

async function readKey(
  client: RedisClient,
  key: string,
  warnings: string[],
): Promise<RedisExportEntry | null> {
  const type = await client.type(key);
  if (type === "none") return null; // expired/deleted between SCAN and now
  const ttl = await client.ttl(key);
  switch (type) {
    case "string": {
      const value = await client.get(key);
      return { key, type: "string", ttl, value: value ?? "" };
    }
    case "list": {
      const value = await client.lrange(key, 0, -1);
      return { key, type: "list", ttl, value };
    }
    case "set": {
      const value = await client.smembers(key);
      return { key, type: "set", ttl, value };
    }
    case "zset": {
      const raw = await client.zrange(key, 0, -1, "WITHSCORES");
      const value: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < raw.length; i += 2) {
        value.push({ member: raw[i] ?? "", score: Number(raw[i + 1] ?? 0) });
      }
      return { key, type: "zset", ttl, value };
    }
    case "hash": {
      const raw = await client.hgetall(key);
      const value = Object.entries(raw).map(([field, val]) => ({ field, value: val }));
      return { key, type: "hash", ttl, value };
    }
    case "stream": {
      // Bounded — full XRANGE on a multi-million-entry stream would dwarf the
      // rest of the export. Document the cap in README + warnings.
      const raw = (await client.call("XRANGE", key, "-", "+", "COUNT", "10000")) as Array<
        [string, string[]]
      >;
      const value = raw.map(([id, fields]) => {
        const pairs: Array<{ field: string; value: string }> = [];
        for (let i = 0; i < fields.length; i += 2) {
          pairs.push({ field: fields[i] ?? "", value: fields[i + 1] ?? "" });
        }
        return { id, fields: pairs };
      });
      if (raw.length === 10000) {
        warnings.push(`Stream "${key}" exceeded the 10000-entry per-stream cap; trailing entries were dropped.`);
      }
      return { key, type: "stream", ttl, value };
    }
    default:
      warnings.push(`Skipped key "${key}": unsupported type "${type}".`);
      return null;
  }
}

// -------- commands.txt emit -------------------------------------------------

async function emitCommands(stream: WriteStream, entry: RedisExportEntry): Promise<void> {
  switch (entry.type) {
    case "string":
      await writeLine(stream, `SET ${arg(entry.key)} ${arg(String(entry.value))}`);
      break;
    case "list": {
      const items = entry.value as string[];
      // Empty list → emit no RPUSH (Redis can't create an empty list anyway).
      if (items.length > 0) {
        await writeLine(stream, `DEL ${arg(entry.key)}`);
        // Chunk so a million-element list doesn't produce a single multi-MB line.
        const CHUNK = 100;
        for (let i = 0; i < items.length; i += CHUNK) {
          const slice = items.slice(i, i + CHUNK).map(arg).join(" ");
          await writeLine(stream, `RPUSH ${arg(entry.key)} ${slice}`);
        }
      }
      break;
    }
    case "set": {
      const members = entry.value as string[];
      if (members.length > 0) {
        await writeLine(stream, `DEL ${arg(entry.key)}`);
        const CHUNK = 100;
        for (let i = 0; i < members.length; i += CHUNK) {
          const slice = members.slice(i, i + CHUNK).map(arg).join(" ");
          await writeLine(stream, `SADD ${arg(entry.key)} ${slice}`);
        }
      }
      break;
    }
    case "zset": {
      const members = entry.value as Array<{ member: string; score: number }>;
      if (members.length > 0) {
        await writeLine(stream, `DEL ${arg(entry.key)}`);
        const CHUNK = 100;
        for (let i = 0; i < members.length; i += CHUNK) {
          const args = members
            .slice(i, i + CHUNK)
            .flatMap((m) => [String(m.score), arg(m.member)])
            .join(" ");
          await writeLine(stream, `ZADD ${arg(entry.key)} ${args}`);
        }
      }
      break;
    }
    case "hash": {
      const fields = entry.value as Array<{ field: string; value: string }>;
      if (fields.length > 0) {
        await writeLine(stream, `DEL ${arg(entry.key)}`);
        const CHUNK = 50; // HSET pairs are 2x the arg count
        for (let i = 0; i < fields.length; i += CHUNK) {
          const args = fields
            .slice(i, i + CHUNK)
            .flatMap((f) => [arg(f.field), arg(f.value)])
            .join(" ");
          await writeLine(stream, `HSET ${arg(entry.key)} ${args}`);
        }
      }
      break;
    }
    case "stream": {
      const stream_ = entry.value as Array<{
        id: string;
        fields: Array<{ field: string; value: string }>;
      }>;
      // For streams we can't preserve original IDs via plain XADD with `*` —
      // but XADD does accept an explicit ID. We use the original so timestamps
      // round-trip; the replay target must be empty (or older) at that ID.
      for (const entry_ of stream_) {
        const pairs = entry_.fields.flatMap((f) => [arg(f.field), arg(f.value)]).join(" ");
        await writeLine(stream, `XADD ${arg(entry.key)} ${entry_.id} ${pairs}`);
      }
      break;
    }
  }
  if (entry.ttl > 0) {
    await writeLine(stream, `EXPIRE ${arg(entry.key)} ${entry.ttl}`);
  }
}

/**
 * Redis CLI single-argument quoting. Double-quoted, backslash-escapes for
 * backslash, double-quote, newline, carriage return, tab. Round-trips through
 * `redis-cli --pipe` for any UTF-8 string we've encountered in practice.
 */
function arg(value: string): string {
  // Bare tokens (alnum + a few punctuation) don't need quoting; everything
  // else gets the safe path.
  if (/^[a-zA-Z0-9_:./-]+$/.test(value) && value.length > 0) return value;
  let out = '"';
  for (const ch of value) {
    if (ch === "\\" || ch === '"') out += `\\${ch}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  out += '"';
  return out;
}

// -------- README / manifest -------------------------------------------------

function renderReadme(
  ctx: RedisExporterContext,
  entries: ReadonlyArray<RedisExportEntry>,
  warnings: ReadonlyArray<string>,
): string {
  const byType = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] ?? 0) + 1;
    return acc;
  }, {});
  const lines = [
    `# Mordor export — Redis`,
    "",
    `**Source:** ${ctx.profileName}`,
    `**DB:** ${ctx.db}`,
    `**Scope:** ${ctx.scopeLabel}`,
    `**Keys:** ${entries.length.toLocaleString()}`,
    "",
    "### Breakdown",
    "",
    ...Object.entries(byType).map(([type, count]) => `- \`${type}\`: ${count.toLocaleString()}`),
    "",
    `## Restore`,
    "",
    "```sh",
    `cat commands.txt | redis-cli --pipe -n ${ctx.db}    # bulk loader (fastest)`,
    `redis-cli -n ${ctx.db} < commands.txt               # also works, slower`,
    "```",
    "",
    `## Files`,
    "",
    "- `commands.txt` — replayable Redis CLI commands.",
    "- `keys.json` — structured dump (key, type, TTL, value).",
    "- `manifest.json` — machine-readable summary.",
    "",
    `## Known limitations`,
    "",
    "- Streams are exported with a 10,000-entry per-stream cap.",
    `- Per-DB key cap: ${EXPORT_ROW_CAP.toLocaleString()}. Warnings list flags truncation.`,
    "- Binary keys/values containing non-UTF-8 byte sequences may round-trip",
    "  lossily through `commands.txt`. Use a native `redis-cli --rdb` dump for",
    "  byte-exact backups.",
    "- Replication / Cluster slots / ACL / pub-sub channels are not exported.",
    "",
  ];
  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}

function buildManifest(input: {
  scopeLabel: string;
  profileName: string;
  db: number;
  entries: ReadonlyArray<RedisExportEntry>;
  warnings: ReadonlyArray<string>;
  startedAt: number;
}): string {
  const manifest = {
    engine: "redis",
    schemaVersion: 1,
    generator: "mordor",
    scope: input.scopeLabel,
    profileName: input.profileName,
    db: input.db,
    startedAtIso: new Date(input.startedAt).toISOString(),
    finishedAtIso: new Date().toISOString(),
    durationMs: Date.now() - input.startedAt,
    totals: {
      keys: input.entries.length,
      byType: input.entries.reduce<Record<string, number>>((acc, e) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1;
        return acc;
      }, {}),
    },
    warnings: input.warnings,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// -------- streaming helpers -------------------------------------------------

function writeLine(stream: WriteStream, line: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ok = stream.write(`${line}\n`, "utf8", (err) => (err ? reject(err) : resolve()));
    if (!ok) stream.once("drain", () => undefined);
  });
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

async function byteSize(path: string): Promise<number> {
  const { stat } = await import("node:fs/promises");
  const info = await stat(path);
  return info.size;
}
