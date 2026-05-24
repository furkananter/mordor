import { previewLimit } from "./cql";

export type QueryMode = "read" | "write" | "all";

export interface NormalizedQuery {
  cql: string;
  limit: number;
  isSelect: boolean;
}

const DML_KEYWORDS = ["insert", "update", "delete", "truncate", "batch", "apply", "begin"];
const DDL_KEYWORDS = ["create", "alter", "drop", "use"];

export function normalizeQuery(input: string, mode: QueryMode = "read"): NormalizedQuery {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("CQL query is required.");
  }

  const statement = stripSingleTrailingSemicolon(trimmed);
  const comparable = statement.replace(/('[^']*')/g, " ");
  if (comparable.includes(";")) {
    throw new Error("Only a single statement is allowed.");
  }

  const isSelect = /^\s*select\b/i.test(comparable);
  const isDdl = DDL_KEYWORDS.some((kw) => new RegExp(`^\\s*${kw}\\b`, "i").test(comparable));
  const isDml = DML_KEYWORDS.some((kw) => new RegExp(`^\\s*${kw}\\b`, "i").test(comparable));

  if (mode === "read" && !isSelect) {
    throw new Error("Read-only mode allows SELECT only. Switch to Write or All in Settings.");
  }
  if (mode === "write" && isDdl) {
    throw new Error("Write mode does not allow DDL (CREATE/ALTER/DROP/USE). Switch to All in Settings.");
  }
  if (mode === "all" && !isSelect && !isDml && !isDdl) {
    // unknown statement type — allow but no auto-limit
  }

  const cql = isSelect && !hasLimitClause(comparable) ? `${statement} LIMIT ${previewLimit}` : statement;
  return { cql, limit: previewLimit, isSelect };
}

export function normalizeSelectQuery(input: string): NormalizedQuery {
  return normalizeQuery(input, "read");
}

function stripSingleTrailingSemicolon(value: string): string {
  return value.endsWith(";") ? value.slice(0, -1).trim() : value;
}

function hasLimitClause(value: string): boolean {
  return /\blimit\s+\d+\b/i.test(value);
}
