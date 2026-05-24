import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { RefObject, useEffect, useRef } from "react";
import { attachMacKeymap } from "./terminalKeymap";
import { buildTerminalTheme } from "./buildTerminalTheme";

interface SessionRefs {
  term: Terminal | null;
  fit: FitAddon | null;
}

export function useTerminalSession(containerRef: RefObject<HTMLDivElement | null>, visible: boolean): SessionRefs {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: buildTerminalTheme(),
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fit;

    attachMacKeymap(term);

    try {
      fit.fit();
    } catch {
      // ignore initial fit failure
    }

    const { cols, rows } = term;
    let cancelled = false;
    let id: string | null = null;
    let unsubData: (() => void) | undefined;
    let unsubExit: (() => void) | undefined;
    let dataHandler: { dispose(): void } | undefined;
    let resizeHandler: { dispose(): void } | undefined;
    const pendingResize = { cols, rows };

    void window.cassandraDesk
      .terminalCreate({ cols, rows })
      .then((createdId) => {
        if (cancelled) {
          window.cassandraDesk.terminalKill(createdId);
          return;
        }
        id = createdId;

        unsubData = window.cassandraDesk.onTerminalData((incomingId, data) => {
          if (incomingId === createdId) term.write(data);
        });
        unsubExit = window.cassandraDesk.onTerminalExit((incomingId) => {
          if (incomingId === createdId) {
            term.writeln("\r\n\x1b[2m[process exited]\x1b[0m");
            id = null;
          }
        });

        dataHandler = term.onData((data) => {
          if (id) window.cassandraDesk.terminalWrite(id, data);
        });
        resizeHandler = term.onResize(({ cols: c, rows: r }) => {
          if (id) window.cassandraDesk.terminalResize(id, c, r);
        });

        window.cassandraDesk.terminalResize(createdId, pendingResize.cols, pendingResize.rows);
      })
      .catch((caught) => {
        term.writeln(`\x1b[31m[terminal failed to start: ${caught instanceof Error ? caught.message : String(caught)}]\x1b[0m`);
      });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore intermediate failures (collapsed / hidden)
      }
    });
    observer.observe(containerRef.current);

    const themeObserver = new MutationObserver(() => {
      term.options.theme = buildTerminalTheme();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelled = true;
      observer.disconnect();
      themeObserver.disconnect();
      dataHandler?.dispose();
      resizeHandler?.dispose();
      unsubData?.();
      unsubExit?.();
      if (id) {
        window.cassandraDesk.terminalKill(id);
        id = null;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [containerRef]);

  useEffect(() => {
    if (!visible || !fitRef.current) return;
    const handle = window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // ignore
      }
      termRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [visible]);

  return { term: termRef.current, fit: fitRef.current };
}
