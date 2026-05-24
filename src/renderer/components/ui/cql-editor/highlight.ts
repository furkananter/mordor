import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--color-accent)", fontWeight: "500" },
  { tag: [t.typeName, t.standard(t.name)], color: "var(--cm-type, #2a6f97)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--cm-fn, #8f4f9b)" },
  { tag: [t.string, t.special(t.string)], color: "var(--cm-string, #7a6014)" },
  { tag: [t.number, t.bool, t.null], color: "var(--cm-number, #a04a1f)" },
  { tag: [t.lineComment, t.blockComment, t.comment], color: "var(--color-subtle)", fontStyle: "italic" },
  { tag: [t.variableName, t.propertyName, t.name], color: "var(--color-text)" },
  { tag: t.punctuation, color: "var(--color-muted)" }
]);
