import { ReactNode, useRef } from "react";

/**
 * Lazy keep-alive tab panel.
 *
 * The workspaces used to swap tab content under a single `<div key={tab}>`.
 * Because each tab renders a DIFFERENT component (CqlPanel vs DataPanel vs the
 * schema editor), switching tabs unmounted one and mounted the other — which
 * tears down and rebuilds CodeMirror's `EditorView`, its single most expensive
 * operation, on every switch. Against a real database that made tab switches
 * visibly janky.
 *
 * TabPanel instead mounts a tab the first time it becomes active and then KEEPS
 * it mounted, toggling visibility with `display` instead of unmounting:
 *   - switching back to a tab is instant (the editor / data grid is still alive)
 *   - the in-progress editor draft and scroll position survive the switch
 *   - tabs the user never opens are never built (the ref starts `false`, so we
 *     render `null` and the lazy chunk import is never triggered)
 *
 * Toggling `display: none → flex` also re-triggers the `anim-fade-slide-up`
 * entrance animation, so the visual behavior matches the old keyed remount.
 */
export function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const everActive = useRef(active);
  if (active) everActive.current = true;
  if (!everActive.current) return null;
  return (
    <div className={active ? "anim-fade-slide-up flex min-h-0 flex-1 flex-col" : "hidden"}>
      {children}
    </div>
  );
}
