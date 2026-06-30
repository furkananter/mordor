import { PreviewFilter, PreviewQuery, PreviewSort } from "../shared/messages";

/**
 * Builds the parameterized `WHERE` / `ORDER BY` / keyset-pagination clauses for
 * a Postgres preview fetch from an optional {@link PreviewQuery}. Pure and
 * dependency-free so the SQL it emits can be unit-tested without a live server.
 *
 * Identifiers are double-quoted (and embedded quotes doubled); every value is
 * bound as a `$n` placeholder — no value is ever interpolated into the SQL text.
 *
 * Keyset pagination: when a sort is given we page by encoding the last row's
 * sort-key values into an opaque cursor (see {@link encodeCursor}). The next
 * fetch turns that cursor into a row-comparison predicate
 * `(c1, c2, ...) > ($a, $b, ...)` (direction-flipped per column via a sign
 * trick — see {@link buildKeysetPredicate}) which the server can satisfy with
 * an index seek instead of an O(n) `OFFSET` scan.
 */

const PG_OP: Record<PreviewFilter["op"], string> = {
  eq: "=",
  neq: "<>",
  contains: "ILIKE",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface PreviewQueryClauses {
  /** e.g. `WHERE "a" = $1 AND "b" ILIKE $2` — empty string when no predicate. */
  whereSql: string;
  /** e.g. `ORDER BY "a" ASC, "b" DESC` — empty string when no sort. */
  orderBySql: string;
  /** Bind values in `$n` order, ready to append to the query parameter array. */
  params: unknown[];
  /** Echoes the effective sort so callers can encode the next-page cursor. */
  sort: PreviewSort[];
}

/**
 * Compose WHERE/ORDER-BY from `query`. `startIndex` is the next free `$n`
 * placeholder number (1-based) so callers can reserve earlier placeholders
 * (e.g. for `LIMIT`). The keyset cursor predicate is folded into the WHERE.
 */
export function buildPreviewQueryClauses(
  query: PreviewQuery | undefined,
  startIndex = 1,
): PreviewQueryClauses {
  const params: unknown[] = [];
  let next = startIndex;
  const placeholder = (value: unknown): string => {
    params.push(value);
    const token = `$${next}`;
    next += 1;
    return token;
  };

  const conditions: string[] = [];
  for (const filter of query?.filters ?? []) {
    if (!filter.column) continue;
    const op = PG_OP[filter.op];
    if (!op) continue;
    const raw = filter.value ?? "";
    // `contains` maps to a case-insensitive substring match; escape the LIKE
    // metacharacters in the user's text so a literal `%`/`_` doesn't widen it.
    const bound = filter.op === "contains" ? `%${escapeLike(raw)}%` : raw;
    conditions.push(`${quoteIdent(filter.column)} ${op} ${placeholder(bound)}`);
  }

  const sort = (query?.sort ?? []).filter((s) => !!s.column);

  // Keyset continuation: only valid alongside a sort (it compares the sort key
  // tuple). A cursor without a sort is ignored — there's no key to compare.
  if (query?.cursor && sort.length > 0) {
    const cursorValues = decodeCursor(query.cursor);
    if (cursorValues && cursorValues.length === sort.length) {
      conditions.push(buildKeysetPredicate(sort, cursorValues, placeholder));
    }
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBySql =
    sort.length > 0
      ? `ORDER BY ${sort
          .map((s) => `${quoteIdent(s.column)} ${s.dir === "desc" ? "DESC" : "ASC"}`)
          .join(", ")}`
      : "";

  return { whereSql, orderBySql, params, sort };
}

/**
 * Row-comparison keyset predicate for the (possibly mixed-direction) sort.
 * Postgres' native `(a, b) > ($1, $2)` row comparison only works when every
 * column shares a direction, so for mixed asc/desc we expand it into the
 * lexicographic OR-of-ANDs form, flipping `>`/`<` per column direction:
 *
 *   (a > $1)
 *   OR (a = $1 AND b < $2)   -- when b is DESC
 *
 * Known v1 limitation: rows whose leading sort key is NULL are dropped by
 * keyset paging. A NULL value serializes to "" in the cursor (see
 * {@link encodeCursor}), and the `>`/`<` comparisons here exclude such rows
 * rather than carrying NULL-aware ordering. Acceptable for preview paging.
 */
function buildKeysetPredicate(
  sort: PreviewSort[],
  cursorValues: string[],
  placeholder: (value: unknown) => string,
): string {
  // Reserve a stable placeholder per sort column so we can reference each more
  // than once across the OR-terms without re-binding the value.
  const tokens = sort.map((_, i) => placeholder(cursorValues[i]));
  const terms: string[] = [];
  for (let i = 0; i < sort.length; i += 1) {
    const parts: string[] = [];
    for (let j = 0; j < i; j += 1) {
      parts.push(`${quoteIdent(sort[j]!.column)} = ${tokens[j]}`);
    }
    const cmp = sort[i]!.dir === "desc" ? "<" : ">";
    parts.push(`${quoteIdent(sort[i]!.column)} ${cmp} ${tokens[i]}`);
    terms.push(`(${parts.join(" AND ")})`);
  }
  return `(${terms.join(" OR ")})`;
}

function escapeLike(value: string): string {
  // Backslash is the default LIKE escape character in Postgres.
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Encode the last row's sort-key values into an opaque base64 cursor. Returns
 * undefined when any sort column is missing from the row (can't form a key).
 */
export function encodeCursor(
  row: Record<string, string>,
  sort: PreviewSort[],
): string | undefined {
  if (sort.length === 0) return undefined;
  const values: string[] = [];
  for (const s of sort) {
    const value = row[s.column];
    if (value === undefined) return undefined;
    values.push(value);
  }
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64");
}

/** Decode a cursor produced by {@link encodeCursor}; undefined when malformed. */
export function decodeCursor(cursor: string): string[] | undefined {
  try {
    const json = Buffer.from(cursor, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed as string[];
    }
    return undefined;
  } catch {
    return undefined;
  }
}
