import { lazy, Suspense, useCallback } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useDragHandle } from "../../hooks/useDragHandle";
import { useTerminalPrewarm } from "../../hooks/useTerminalPrewarm";
import { useLayoutStore } from "../../store/layout";

const TerminalPanel = lazy(() =>
  import("./terminal/TerminalPanel").then((m) => ({ default: m.TerminalPanel }))
);

/**
 * Bottom-pinned terminal drawer. Self-contained: drag-to-resize, lazy mount,
 * close button, height/open state from layout store. The height animation is a
 * plain CSS transition so we don't pull framer-motion into the initial bundle
 * just for one drawer.
 */
export function TerminalDrawer() {
  const terminalOpen = useLayoutStore((state) => state.terminalOpen);
  const terminalHeight = useLayoutStore((state) => state.terminalHeight);
  const setTerminalOpen = useLayoutStore((state) => state.setTerminalOpen);
  const setTerminalHeight = useLayoutStore((state) => state.setTerminalHeight);
  const terminalMounted = useTerminalPrewarm(terminalOpen);

  const drag = useDragHandle(
    "y",
    useCallback((clientY: number) => setTerminalHeight(window.innerHeight - clientY), [setTerminalHeight])
  );

  if (!terminalMounted) return null;

  return (
    <section
      key="terminal-drawer"
      data-resizing={drag.resizing ? "true" : "false"}
      style={{
        height: terminalOpen ? terminalHeight : 0,
        // Drag interactions snap immediately; toggle open/close eases in/out.
        transition: drag.resizing ? "none" : "height 220ms cubic-bezier(0.32, 0.72, 0, 1)"
      }}
      className="relative flex shrink-0 flex-col overflow-hidden border-t border-line bg-panel"
      aria-label="Terminal"
      aria-hidden={!terminalOpen}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onMouseDown={drag.onMouseDown}
        data-active={drag.resizing ? "true" : "false"}
        className="absolute left-0 right-0 top-0 z-10 h-1 -translate-y-1/2 cursor-row-resize bg-transparent transition-colors hover:bg-accent/60 data-[active=true]:bg-accent"
      />
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">Terminal</span>
        <Button variant="icon" onClick={() => setTerminalOpen(false)} tooltip="Close (⌘J)" tooltipPlacement="left">
          <X size={12} strokeWidth={1.7} />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={null}>
          <TerminalPanel visible={terminalOpen} />
        </Suspense>
      </div>
    </section>
  );
}
