/**
 * Format helpers shared by every engine's export renderer. The escapes here
 * are deliberately strict — we'd rather produce slightly over-quoted output
 * that round-trips losslessly than a "prettier" dump that fails to parse on
 * restore.
 */

/** SQL/CQL string literal escape: doubles internal single quotes. */
export function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Double-quoted identifier escape (works for Postgres + CQL — both use
 * `"..."` for reserved/case-sensitive names and accept `""` to embed a quote).
 */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * CSV field escape per RFC 4180. We quote unconditionally only when the field
 * contains a delimiter, quote, CR, or LF — bare ASCII fields stay unquoted for
 * readability. Empty strings are written as bare empty (the default Excel
 * treats as empty cell, not the literal "" pair).
 */
export function csvField(value: string): string {
  if (value === "") return "";
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Joins fields with commas + terminates with CRLF (the strict RFC line ending). */
export function csvRow(fields: readonly string[]): string {
  return `${fields.map(csvField).join(",")}\r\n`;
}

/**
 * Timestamp suffix for the default export folder name. We use UTC and a
 * filesystem-safe `YYYYMMDD-HHmmss` so two exports cut in the same second
 * (rare but possible for the table-level scope) collide loudly via the OS
 * rather than silently overwriting.
 */
export function timestampSuffix(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

/**
 * Strip characters that aren't safe in a filesystem path component. Used for
 * the folder slug — connection names can contain spaces, slashes, colons. We
 * lowercase + collapse runs of non-alnum to a single dash so the output is
 * predictable and shell-friendly.
 */
export function folderSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "export";
}
