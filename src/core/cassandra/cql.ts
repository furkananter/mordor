import { PreviewFilter, PreviewQuery } from "../shared/messages";

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

const CQL_OP: Partial<Record<PreviewFilter["op"], string>> = {
  eq: "=",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  // `neq`/`contains` have no first-class CQL equivalent on arbitrary columns —
  // they're dropped here (the renderer keeps client-side filtering as a fallback).
};

export interface CqlPreviewClause {
  /** Bound parameters in `?` order. */
  params: unknown[];
  /** e.g. ` WHERE "a" = ? AND "b" > ?` — empty string when no predicate. */
  whereSql: string;
  /**
   * True when at least one predicate targets a NON-key column, which Cassandra
   * can only satisfy with `ALLOW FILTERING` — a full-cluster scan. The caller
   * appends `ALLOW FILTERING` and is expected to document/accept the cost.
   */
  needsAllowFiltering: boolean;
}

/**
 * Build a best-effort CQL `WHERE` clause from a {@link PreviewQuery}. Cassandra
 * can only filter efficiently on key columns, so equality on partition/clustering
 * keys is native; any other supported predicate forces `ALLOW FILTERING`. Sort
 * is intentionally ignored — CQL `ORDER BY` is restricted to clustering columns
 * within a partition and can't express the renderer's arbitrary-column sort, so
 * sorting stays client-side. Unsupported ops (`neq`, `contains`) are skipped.
 */
export function buildCqlPreviewClause(
  query: PreviewQuery | undefined,
  keyColumns: ReadonlySet<string>,
): CqlPreviewClause {
  const params: unknown[] = [];
  const conditions: string[] = [];
  let needsAllowFiltering = false;

  for (const filter of query?.filters ?? []) {
    if (!filter.column) continue;
    const op = CQL_OP[filter.op];
    if (!op) continue;
    const isKey = keyColumns.has(filter.column);
    // Non-key predicates, and non-equality predicates on keys, both require a
    // scan in Cassandra → ALLOW FILTERING.
    if (!isKey || filter.op !== "eq") needsAllowFiltering = true;
    conditions.push(`${quoteIdentifier(filter.column)} ${op} ?`);
    params.push(filter.value ?? "");
  }

  const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  return { params, whereSql, needsAllowFiltering };
}
