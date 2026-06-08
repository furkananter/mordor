/**
 * Cross-component state for the export feature: tracks the most-recent result
 * (so a banner can render across both Sidebar-spawned and Workspace-spawned
 * exports) plus a `running` flag the buttons read to disable themselves
 * during an active export.
 *
 * Kept separate from `useStatusStore` because export results carry richer
 * payload (folder path, artifact list, warnings) than the generic busy/error
 * strings — and because export UI needs to outlive a single profile selection
 * (running export, switch profiles, return: the banner should still be there).
 */

import { create } from "zustand";
import type { ExportResult } from "../../core/export/types";

interface ExportStatusState {
  /** Active export's label ("Exporting public.orders…"). Undefined when idle. */
  running: string | undefined;
  /** Last successful export — banner uses this for the "Open folder" CTA. */
  lastResult: ExportResult | undefined;
  /** Last failure message — banner uses this for the error variant. */
  lastError: string | undefined;
}

interface ExportStatusActions {
  setRunning(label: string | undefined): void;
  setResult(result: ExportResult | undefined): void;
  setError(error: string | undefined): void;
  /** Dismiss the most recent result/error banner without touching `running`. */
  dismiss(): void;
}

export const useExportStatusStore = create<ExportStatusState & ExportStatusActions>((set) => ({
  running: undefined,
  lastResult: undefined,
  lastError: undefined,
  setRunning: (running) => set({ running }),
  setResult: (lastResult) => set({ lastResult, lastError: undefined }),
  setError: (lastError) => set({ lastError, lastResult: undefined }),
  dismiss: () => set({ lastResult: undefined, lastError: undefined }),
}));
