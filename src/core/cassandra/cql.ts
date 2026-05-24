/**
 * Per-page chunk size for preview reads. We no longer apply this as a CQL
 * `LIMIT` (which capped the total at 1000 rows); instead it's the driver-level
 * `fetchSize` that controls how many rows come back per round-trip, with
 * pageState carrying continuation forward when the user asks for more.
 */
export const previewLimit = 1000;

export function quoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error("CQL identifier cannot be empty.");
  }

  return `"${trimmed.replace(/"/g, '""')}"`;
}

export function buildTablePreviewQuery(
  keyspace: string,
  table: string,
): string {
  return `SELECT * FROM ${quoteIdentifier(keyspace)}.${quoteIdentifier(table)}`;
}
