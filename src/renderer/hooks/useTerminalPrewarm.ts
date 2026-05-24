import { useEffect, useState } from "react";

/**
 * Returns whether the terminal chunk should be mounted. We used to eagerly
 * pre-warm xterm + node-pty 2.5 seconds after page load to make the first
 * terminal toggle feel instant, but it paid for itself only for users who
 * actually opened the terminal — for everyone else it was a ~0.9 second
 * blocking JS task that landed right when they were trying to interact with
 * the sidebar. Now we mount strictly on demand: the terminal chunk only
 * downloads + parses the first time the user opens it. Once mounted we keep
 * it mounted so subsequent toggles stay instant.
 */
export function useTerminalPrewarm(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  return mounted;
}
