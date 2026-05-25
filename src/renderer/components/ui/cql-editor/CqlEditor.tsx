import { sql } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import { CqlEditorSchema, buildAutocomplete } from "./autocomplete";
import { cassandraDialect, postgresDialect } from "./dialect";
import { highlightStyle } from "./highlight";
import { editorTheme } from "./theme";

export type { CqlEditorSchema } from "./autocomplete";

/** Which SQL dialect drives syntax highlighting and the bundled autocomplete. */
export type CqlEditorDialect = "cassandra" | "postgres";

export function CqlEditor({
  value,
  onChange,
  onRun,
  placeholder,
  completions,
  ariaLabel,
  dialect = "cassandra"
}: {
  value: string;
  onChange(value: string): void;
  onRun(): void;
  placeholder?: string;
  completions?: CqlEditorSchema;
  ariaLabel?: string;
  dialect?: CqlEditorDialect;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(
    () => [
      // PostgresWorkspace passes dialect="postgres" so SQL keywords (RETURNING,
      // ON CONFLICT, jsonb operators, `$body$ ... $body$`) are recognized and
      // the Cassandra-specific autocomplete doesn't pollute pg suggestions.
      sql({
        dialect: dialect === "postgres" ? postgresDialect : cassandraDialect,
        upperCaseKeywords: true
      }),
      syntaxHighlighting(highlightStyle),
      editorTheme,
      buildAutocomplete(completions, dialect),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRun();
              return true;
            }
          }
        ])
      ),
      EditorView.lineWrapping
    ],
    [completions, onRun, dialect]
  );

  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      {...(placeholder ? { placeholder } : {})}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: false,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        searchKeymap: false
      }}
      aria-label={ariaLabel}
      className="cm-cassandra h-full"
      height="100%"
    />
  );
}
