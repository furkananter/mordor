import { EditorView } from "@codemirror/view";

export const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-panel)",
    color: "var(--color-text)",
    height: "100%",
    fontSize: "12.5px"
  },
  ".cm-scroller": {
    backgroundColor: "var(--color-panel)",
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.7"
  },
  ".cm-content": { padding: "12px 0 12px 12px", caretColor: "var(--color-accent)" },
  ".cm-line": { padding: "0 8px 0 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--color-subtle)",
    border: "none",
    borderRight: "1px solid var(--color-line-soft)",
    paddingRight: "2px"
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "22px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--color-accent) 6%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-text)" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent) !important"
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-panel)",
    border: "1px solid var(--color-line)",
    borderRadius: "6px",
    color: "var(--color-text)",
    fontFamily: "Inter, ui-sans-serif, system-ui"
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-line-soft)",
    color: "var(--color-text)"
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 8px", fontSize: "12px" }
});
