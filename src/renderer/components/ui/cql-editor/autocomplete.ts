import { autocompletion, completeFromList } from "@codemirror/autocomplete";
import {
  CASSANDRA_FUNCTIONS,
  CASSANDRA_KEYWORDS,
  CASSANDRA_TYPES,
  POSTGRES_FUNCTIONS,
  POSTGRES_KEYWORDS,
  POSTGRES_TYPES
} from "./dialect";

export interface CqlEditorSchema {
  tables?: string[];
  columns?: string[];
}

export function buildAutocomplete(
  completions?: CqlEditorSchema,
  dialect: "cassandra" | "postgres" = "cassandra"
) {
  // Pick the keyword/type/function set matching the dialect so the Postgres
  // editor doesn't suggest Cassandra-only tokens (and vice versa). The
  // schema-aware tables/columns slot is dialect-agnostic.
  const keywords = dialect === "postgres" ? POSTGRES_KEYWORDS : CASSANDRA_KEYWORDS;
  const types = dialect === "postgres" ? POSTGRES_TYPES : CASSANDRA_TYPES;
  const functions = dialect === "postgres" ? POSTGRES_FUNCTIONS : CASSANDRA_FUNCTIONS;

  const completionList = [
    ...keywords.map((label) => ({ label: label.toUpperCase(), type: "keyword" })),
    ...types.map((label) => ({ label, type: "type" })),
    ...functions.map((label) => ({ label: label.toUpperCase(), type: "function" })),
    ...(completions?.tables ?? []).map((label) => ({ label, type: "class" })),
    ...(completions?.columns ?? []).map((label) => ({ label, type: "property" }))
  ];

  return autocompletion({ override: [completeFromList(completionList)] });
}
