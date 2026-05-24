import { autocompletion, completeFromList } from "@codemirror/autocomplete";
import { CASSANDRA_FUNCTIONS, CASSANDRA_KEYWORDS, CASSANDRA_TYPES } from "./dialect";

export interface CqlEditorSchema {
  tables?: string[];
  columns?: string[];
}

export function buildAutocomplete(completions?: CqlEditorSchema) {
  const completionList = [
    ...CASSANDRA_KEYWORDS.map((label) => ({ label: label.toUpperCase(), type: "keyword" })),
    ...CASSANDRA_TYPES.map((label) => ({ label, type: "type" })),
    ...CASSANDRA_FUNCTIONS.map((label) => ({ label: label.toUpperCase(), type: "function" })),
    ...(completions?.tables ?? []).map((label) => ({ label, type: "class" })),
    ...(completions?.columns ?? []).map((label) => ({ label, type: "property" }))
  ];

  return autocompletion({ override: [completeFromList(completionList)] });
}
