import { Profiler, ProfilerOnRenderCallback, ReactNode } from "react";

/**
 * Opt-in render profiler. It is a no-op (and adds no Profiler to the tree) unless
 * explicitly enabled, so it is safe to leave wrapped around hot regions in
 * production. To turn it on, run this in the devtools console and reload:
 *
 *   localStorage.setItem("mordor:perf", "1"); location.reload();
 *
 * Commits slower than one 60fps frame are logged with the zone id, phase
 * (mount/update) and duration, so you can see which region is eating frames
 * when something feels laggy. Turn it off with:
 *
 *   localStorage.removeItem("mordor:perf"); location.reload();
 */
const ENABLED =
  typeof localStorage !== "undefined" && localStorage.getItem("mordor:perf") === "1";

// Roughly one frame at 60fps — commits over this are the ones worth chasing.
const SLOW_COMMIT_MS = 16;

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  if (actualDuration >= SLOW_COMMIT_MS) {
    // eslint-disable-next-line no-console
    console.warn(`[perf] ${id} · ${phase} · ${actualDuration.toFixed(1)}ms`);
  }
};

export function PerfZone({ id, children }: { id: string; children: ReactNode }) {
  if (!ENABLED) return <>{children}</>;
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
