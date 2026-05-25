/**
 * Convert raw pg row values into the JSON-string form the renderer's data
 * grid expects. The grid stores cells as `Record<string, string>` so it can
 * filter/sort/copy uniformly; it's the service layer's job to project rich
 * driver types (Date, Buffer, JSON objects, arrays, BigInt) into a faithful
 * string. The Cassandra side does the same — keeping the contract identical
 * lets the same DataTable render either DB's rows.
 */
export function serializePostgresRows(
  rows: Array<Record<string, unknown>>
): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      out[key] = stringifyValue(row[key]);
    }
    return out;
  });
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (Array.isArray(value)) {
    // pg arrays come back as JS arrays. Render Postgres-array literal so the
    // user sees something close to what the server would print, with elements
    // recursively stringified.
    return `{${value.map((entry) => stringifyArrayElement(entry)).join(",")}}`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function stringifyArrayElement(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") {
    // Quote and escape per Postgres array literal rules so the rendered output
    // round-trips for the common cases (no nested arrays of arrays here).
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return stringifyValue(value);
}
