import { useRef } from "react";
import { useTerminalSession } from "./useTerminalSession";

export function TerminalPanel({ visible }: { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminalSession(containerRef, visible);
  return <div ref={containerRef} className="h-full w-full px-2 py-1.5" />;
}
