import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { MigrationEntry } from "./types";

export class MigrationFileStore {
  async list(folder: string): Promise<MigrationEntry[]> {
    assertFolder(folder);
    let entries: string[];
    try {
      entries = await readdir(folder);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      throw new Error(`Cannot read migrations folder: ${message}`);
    }

    const cqlFiles = entries.filter((filename) => extname(filename).toLowerCase() === ".cql");
    cqlFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    const loaded: MigrationEntry[] = [];
    for (const filename of cqlFiles) {
      const contents = await readFile(join(folder, filename), "utf8");
      const { version, name } = parseFilename(filename);
      loaded.push({
        version,
        name,
        filename,
        contents,
        checksum: createHash("sha256").update(contents).digest("hex")
      });
    }
    return loaded;
  }

  async readOne(folder: string, filename: string): Promise<string> {
    assertFolder(folder);
    assertCqlFilename(filename);
    return readFile(join(folder, filename), "utf8");
  }

  async writeOne(folder: string, filename: string, contents: string): Promise<void> {
    assertFolder(folder);
    assertCqlFilename(filename);
    await writeFile(join(folder, filename), contents, "utf8");
  }

  async create(folder: string, name: string): Promise<{ filename: string; version: string }> {
    assertFolder(folder);
    const entries = await this.list(folder);
    const nextVersion = computeNextVersion(entries);
    const slug = slugify(name) || "migration";
    const filename = `V${nextVersion}__${slug}.cql`;
    const template = `-- ${filename}\n-- Created ${new Date().toISOString()}\n\n`;
    await writeFile(join(folder, filename), template, { flag: "wx" });
    return { filename, version: String(nextVersion) };
  }
}

export function assertFolder(folder: string): void {
  if (typeof folder !== "string" || folder.length === 0) {
    throw new Error("Migrations folder is not configured.");
  }
}

export function assertCqlFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..") || !/\.cql$/i.test(filename)) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }
}

function parseFilename(filename: string): { version: string; name: string } {
  const base = filename.replace(/\.cql$/i, "");
  const match = base.match(/^([Vv]?\d+(?:[._-]\d+)*)(?:__|[-_ ])?(.*)$/);
  if (match) {
    const version = (match[1] ?? base).replace(/^[Vv]/, "");
    const name = match[2]?.replace(/[_-]+/g, " ").trim() || base;
    return { version, name };
  }
  return { version: base, name: base };
}

function computeNextVersion(entries: MigrationEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    const first = entry.version.split(/[._-]/)[0];
    const num = Number.parseInt(first ?? "", 10);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return max + 1;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
