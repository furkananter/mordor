/**
 * Splits a CQL/SQL script into individual statements.
 *
 * Handles:
 *   - `;` terminators outside string literals
 *   - Single-quoted strings (with `''` escape)
 *   - Dollar-quoted strings — both bare `$$...$$` and tagged `$tag$...$tag$`
 *     (Postgres syntax used by CREATE FUNCTION / CREATE PROCEDURE / DO blocks
 *     to embed bodies that contain `;` and `'`). The tag is `[A-Za-z_][A-Za-z0-9_]*`
 *     per the Postgres grammar; identical opening and closing tag is required.
 *   - Line comments (`--` and `//`)
 *   - Block comments (slash-star ... star-slash)
 *   - `BEGIN BATCH ... APPLY BATCH;` blocks kept as one statement (Cassandra-only;
 *     the keyword gate means real SQL scripts never trigger this branch)
 */
export function splitCqlStatements(input: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let i = 0;
  let inBatch = false;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (!inBatch && (ch === "-" && next === "-")) {
      i = skipToEol(input, i);
      continue;
    }
    if (!inBatch && (ch === "/" && next === "/")) {
      i = skipToEol(input, i);
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }

    if (ch === "'") {
      const end = scanSingleQuoted(input, i);
      buffer += input.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "$") {
      const opener = scanDollarTag(input, i);
      if (opener) {
        const closeAt = input.indexOf(opener.literal, opener.end);
        const stop = closeAt === -1 ? input.length : closeAt + opener.literal.length;
        buffer += input.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (!inBatch && matchesKeyword(input, i, "BEGIN") && followedByBatch(input, i + 5)) {
      inBatch = true;
      buffer += ch;
      i += 1;
      continue;
    }

    if (inBatch && matchesKeyword(input, i, "APPLY") && followedByBatch(input, i + 5)) {
      const applyEnd = consumeApplyBatch(input, i);
      buffer += input.slice(i, applyEnd);
      i = applyEnd;
      inBatch = false;
      pushIfNotEmpty(statements, buffer);
      buffer = "";
      continue;
    }

    if (ch === ";" && !inBatch) {
      pushIfNotEmpty(statements, buffer);
      buffer = "";
      i += 1;
      continue;
    }

    buffer += ch;
    i += 1;
  }

  pushIfNotEmpty(statements, buffer);
  return statements;
}

function pushIfNotEmpty(statements: string[], buffer: string): void {
  const trimmed = buffer.trim();
  if (trimmed) {
    statements.push(trimmed);
  }
}

function skipToEol(input: string, start: number): number {
  const newline = input.indexOf("\n", start);
  return newline === -1 ? input.length : newline + 1;
}

/**
 * If `start` is the opening `$` of a Postgres dollar-quoted string, return the
 * literal opener (e.g. `$$` or `$body$`) and the index right after it. Returns
 * undefined otherwise — the caller treats `$` as a normal character (could be
 * a column ref like `$1` in a placeholder, currency, etc.).
 *
 * Postgres tag grammar: an opener is `$` + optional identifier (letters,
 * digits, underscore; cannot start with digit) + `$`. The closer is the same
 * literal string. The body between can contain anything except that literal.
 */
function scanDollarTag(
  input: string,
  start: number,
): { literal: string; end: number } | undefined {
  // Bare $$ — fast path.
  if (input[start + 1] === "$") {
    return { literal: "$$", end: start + 2 };
  }
  // Tagged $tag$ — accumulate identifier chars until the next `$`.
  let i = start + 1;
  // Reject if first char isn't a valid identifier start. `$1`, `$2` (parameter
  // placeholders) hit this branch — we don't treat them as dollar-quotes.
  if (i >= input.length || !/[A-Za-z_]/.test(input[i]!)) return undefined;
  while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) {
    i += 1;
  }
  if (input[i] !== "$") return undefined;
  return { literal: input.slice(start, i + 1), end: i + 1 };
}

function scanSingleQuoted(input: string, start: number): number {
  let i = start + 1;
  while (i < input.length) {
    if (input[i] === "'") {
      if (input[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return input.length;
}

function matchesKeyword(input: string, index: number, keyword: string): boolean {
  if (index > 0) {
    const prev = input[index - 1] ?? "";
    if (/[A-Za-z0-9_]/.test(prev)) {
      return false;
    }
  }
  const candidate = input.slice(index, index + keyword.length);
  return candidate.toUpperCase() === keyword;
}

function followedByBatch(input: string, index: number): boolean {
  let i = index;
  while (i < input.length && /\s/.test(input[i] ?? "")) {
    i += 1;
  }
  return matchesKeyword(input, i, "BATCH");
}

function consumeApplyBatch(input: string, start: number): number {
  let i = start + "APPLY".length;
  while (i < input.length && /\s/.test(input[i] ?? "")) {
    i += 1;
  }
  i += "BATCH".length;
  while (i < input.length && input[i] !== ";") {
    i += 1;
  }
  return Math.min(i + 1, input.length);
}
