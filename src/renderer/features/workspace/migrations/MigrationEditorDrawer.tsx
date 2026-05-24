import { lazy, Suspense, useEffect, useState } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useLayoutStore } from "../../../store/layout";

const CqlEditor = lazy(() =>
  import("../../../components/ui/cql-editor/CqlEditor").then((m) => ({ default: m.CqlEditor }))
);

export function MigrationEditorDrawer({
  folder,
  filename,
  onClose,
  onSaved
}: {
  folder: string;
  filename: string;
  onClose(): void;
  onSaved(): void;
}) {
  const drawerWidth = useLayoutStore((state) => state.migrationsDrawerWidth);
  const setDrawerWidth = useLayoutStore((state) => state.setMigrationsDrawerWidth);
  const [resizing, setResizing] = useState(false);

  const handleResizeStart = (event: React.MouseEvent) => {
    event.preventDefault();
    setResizing(true);
    const onMove = (move: MouseEvent) => setDrawerWidth(window.innerWidth - move.clientX);
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [original, setOriginal] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const dirty = original !== undefined && draft !== original;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setOriginal(undefined);
    setDraft("");
    window.cassandraDesk
      .readMigrationFile(folder, filename)
      .then((contents) => {
        if (cancelled) return;
        setOriginal(contents);
        setDraft(contents);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folder, filename]);

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(undefined);
    try {
      await window.cassandraDesk.writeMigrationFile(folder, filename, draft);
      setOriginal(draft);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside
      style={{ width: `${drawerWidth}px` }}
      className="anim-fade-in relative flex min-w-0 shrink-0 flex-col border-l border-line bg-panel"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor"
        onMouseDown={handleResizeStart}
        data-active={resizing ? "true" : "false"}
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-accent/60 data-[active=true]:bg-accent"
      />
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-2">
        <div className="grid min-w-0 gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-medium text-text">{filename}</span>
            {dirty ? (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">unsaved</span>
            ) : null}
          </div>
          <span className="text-[11px] text-subtle">
            {dirty ? "Edits will be discarded if you close." : "Synced with disk."}
          </span>
        </div>
        <Button variant="icon" onClick={onClose} tooltip="Close (discards unsaved)" tooltipPlacement="left">
          <X size={13} strokeWidth={1.7} />
        </Button>
      </header>

      <div className="flex items-center justify-end gap-1 border-b border-line-soft px-3 py-1.5">
        <Button
          onClick={() => original !== undefined && setDraft(original)}
          disabled={!dirty || saving}
          tooltip="Revert to disk version"
        >
          <RotateCcw size={11} strokeWidth={1.7} />
          <span>Revert</span>
        </Button>
        <Button variant="primary" onClick={() => void handleSave()} disabled={!dirty || saving}>
          <Save size={11} strokeWidth={1.7} />
          <span>{saving ? "Saving…" : "Save"}</span>
        </Button>
      </div>

      {error ? (
        <div className="border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">{error}</div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="px-3 py-3 text-[12px] text-muted">Loading file…</div>
        ) : original !== undefined ? (
          <Suspense fallback={<div className="px-3 py-3 text-[12px] text-muted">Loading editor…</div>}>
            <CqlEditor
              value={draft}
              onChange={setDraft}
              onRun={() => void handleSave()}
              ariaLabel={`Edit ${filename}`}
            />
          </Suspense>
        ) : null}
      </div>
    </aside>
  );
}
