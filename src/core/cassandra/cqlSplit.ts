/**
 * Splits a CQL script into individual statements.
 *
 * Handles:
 *   - `;` terminators outside string literals
 *   - Single-quoted strings (with `''` escape)
 *   - Dollar-quoted strings (`$$...$$`)
 *   - Line comments (`--` and `//`)
 *   - Block comments (slash-star ... star-slash)
 *   - `BEGIN BATCH ... APPLY BATCH;` blocks kept as one statement
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

    if (ch === "$" && next === "$") {
      const end = input.indexOf("$$", i + 2);
      const stop = end === -1 ? input.length : end + 2;
      buffer += input.slice(i, stop);
      i = stop;
      continue;
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
