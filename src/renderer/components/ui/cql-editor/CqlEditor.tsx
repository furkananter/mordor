import { sql } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import { CqlEditorSchema, buildAutocomplete } from "./autocomplete";
import { cassandraDialect } from "./dialect";
import { highlightStyle } from "./highlight";
import { editorTheme } from "./theme";

export type { CqlEditorSchema } from "./autocomplete";

export function CqlEditor({
  value,
  onChange,
  onRun,
  placeholder,
  completions,
  ariaLabel
}: {
  value: string;
  onChange(value: string): void;
  onRun(): void;
  placeholder?: string;
  completions?: CqlEditorSchema;
  ariaLabel?: string;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo(
    () => [
      sql({ dialect: cassandraDialect, upperCaseKeywords: true }),
      syntaxHighlighting(highlightStyle),
      editorTheme,
      buildAutocomplete(completions),
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
    [completions, onRun]
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
