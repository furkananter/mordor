import { useEffect, useRef, useState } from "react";

interface Options {
  enabled: boolean;
  intervalMs: number;
  /** Invoked on every tick. Skipped if a previous invocation is still pending. */
  onTick(): Promise<void> | void;
  /** Optional dependency key (e.g. selected table id). Resets the timer when it changes. */
  key?: unknown;
}

interface State {
  /** Timestamp of the last successful tick. */
  lastTickAt: number | undefined;
  /** Whether a tick is currently in flight. */
  pending: boolean;
}

export function useLivePolling({ enabled, intervalMs, onTick, key }: Options): State {
  const [lastTickAt, setLastTickAt] = useState<number | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const inFlightRef = useRef(false);
  const callbackRef = useRef(onTick);

  // Keep latest callback without resetting the interval each render.
  useEffect(() => {
    callbackRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    setLastTickAt(undefined);
  }, [key]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      if (inFlightRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inFlightRef.current = true;
      setPending(true);
      try {
        await callbackRef.current();
        if (!cancelled) setLastTickAt(Date.now());
      } finally {
        inFlightRef.current = false;
        if (!cancelled) setPending(false);
      }
    };

    // Fire immediately, then on each interval.
    void run();
    const id = window.setInterval(() => void run(), intervalMs);

    const onVisibility = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, intervalMs, key]);

  return { lastTickAt, pending };
}
