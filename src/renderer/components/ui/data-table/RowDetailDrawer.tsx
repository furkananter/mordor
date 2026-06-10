import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";
import { Button } from "../Button";
import { Row } from "./types";

/**
 * Slide-in panel that shows a single row in full — one field per line, with
 * long text wrapped and JSON/collection columns pretty-printed as a structured
 * tree instead of a one-line blob. Opened by clicking a row in the table; the
 * ◂ ▸ controls step through the current (filtered/sorted) result without
 * closing the panel.
 */
export function RowDetailDrawer({
  rows,
  index,
  columns,
  columnTypes,
  title,
  onNavigate,
  onClose
}: {
  rows: Row[];
  index: number;
  columns: string[];
  columnTypes?: Record<string, string> | undefined;
  title?: string;
  onNavigate(index: number): void;
  onClose(): void;
}) {
  const row = rows[index];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowDown" && index < rows.length - 1) onNavigate(index + 1);
      else if (event.key === "ArrowUp" && index > 0) onNavigate(index - 1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, rows.length, onNavigate, onClose]);

  if (!row) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Row detail"
        onMouseDown={(event) => event.stopPropagation()}
        className="anim-fade-slide-right relative flex h-full w-full max-w-[520px] flex-col border-l border-line bg-panel text-text shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
          <div className="grid min-w-0 gap-0.5">
            <span className="truncate text-[13px] font-semibold leading-tight text-text">
              {title ?? "Row detail"}
            </span>
            <span className="text-[11px] text-subtle">
              Row {index + 1} of {rows.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="icon"
              onClick={() => onNavigate(index - 1)}
              disabled={index <= 0}
              tooltip="Previous row (↑)"
              aria-label="Previous row"
            >
              <ChevronLeft size={14} strokeWidth={1.7} />
            </Button>
            <Button
              variant="icon"
              onClick={() => onNavigate(index + 1)}
              disabled={index >= rows.length - 1}
              tooltip="Next row (↓)"
              aria-label="Next row"
            >
              <ChevronRight size={14} strokeWidth={1.7} />
            </Button>
            <Button variant="icon" onClick={onClose} tooltip="Close (Esc)" aria-label="Close row detail">
              <X size={14} strokeWidth={1.7} />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <dl className="grid gap-3">
            {columns.map((column) => (
              <FieldRow key={column} name={column} type={columnTypes?.[column]} value={row[column] ?? ""} />
            ))}
          </dl>
        </div>
      </aside>
    </div>,
    document.body
  );
}

function FieldRow({ name, type, value }: { name: string; type: string | undefined; value: string }) {
  const structured = parseStructured(value);
  return (
    <div className="grid gap-1 border-b border-line-soft pb-3 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-mono text-[12px] font-medium text-text">{name}</span>
          {type ? <span className="shrink-0 font-mono text-[10.5px] text-subtle">{type}</span> : null}
        </div>
        <CopyButton value={value} />
      </div>
      {value === "" ? (
        <span className="font-mono text-[12px] italic text-subtle">null</span>
      ) : structured !== undefined ? (
        <div className="rounded-ui border border-line-soft bg-line-soft/30 px-2.5 py-2">
          <JsonView value={structured} />
        </div>
      ) : (
        <span className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.5] text-text">
          {value}
        </span>
      )}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="shrink-0 rounded p-1 text-subtle transition-colors hover:bg-line-soft hover:text-text"
      title="Copy value"
      aria-label={`Copy ${value === "" ? "empty value" : "value"}`}
    >
      {copied ? <Check size={12} strokeWidth={1.8} className="text-success" /> : <Copy size={12} strokeWidth={1.7} />}
    </button>
  );
}

/**
 * Recursively renders a parsed JSON value as an indented tree. Kept dependency
 * free — Cassandra maps/lists/sets and Postgres json/jsonb columns all arrive
 * as serialized strings, and this is the shared structured view for them.
 */
function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span className="text-subtle">null</span>;
  if (typeof value === "string") return <span className="text-success">&quot;{value}&quot;</span>;
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-accent">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted">[]</span>;
    return (
      <div className="grid">
        {value.map((entry, i) => (
          <div key={i} style={{ paddingLeft: depth > 0 ? 12 : 0 }} className="flex gap-1.5">
            <span className="text-subtle">{i}:</span>
            <JsonView value={entry} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted">{"{}"}</span>;
  return (
    <div className="grid">
      {entries.map(([key, entry]) => (
        <div key={key} style={{ paddingLeft: depth > 0 ? 12 : 0 }} className="flex gap-1.5">
          <span className="text-muted">{key}:</span>
          <JsonView value={entry} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

/**
 * Returns the parsed object/array when `value` is JSON describing one, else
 * undefined (so scalars and plain strings render as text, not as quoted JSON).
 */
function parseStructured(value: string): unknown {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
