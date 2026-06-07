/**
 * `useExport()` — the single entry point UI buttons use to kick off an
 * export. Wraps the folder picker + IPC call + cross-component status store
 * so the call site is a one-liner:
 *
 *     const { runExport, running } = useExport();
 *     <button disabled={Boolean(running)}
 *             onClick={() => runExport({
 *               profileId, scope: "full",
 *               summary: `full database (${profileName})`
 *             })} />
 *
 * The hook handles:
 *   - asking the OS for a target folder (skipped when the caller passes
 *     `outputDir` directly — useful for tests),
 *   - flipping the global "running" flag so every other Export button across
 *     the app greys out for the duration,
 *   - writing the success/error into the export status store so the banner
 *     in App.tsx can render the "Open folder" CTA without prop-drilling.
 *
 * The hook deliberately does not surface progress mid-export — the main
 * process completes the whole dump before resolving. Mid-flight progress
 * would need a separate pushed channel; queued for a follow-up.
 */

import { useCallback } from "react";
import type { ExportRequest, ExportResult } from "../../../core/export/types";
import { useExportStatusStore } from "../../store/exportStatus";

export interface RunExportInput {
  /** Pre-built request, minus `outputDir` (which we resolve via the picker). */
  request: Omit<ExportRequest, "outputDir">;
  /** Human label rendered on the busy badge ("Exporting public.orders…"). */
  summary: string;
  /** Pre-resolved output folder. When omitted we pop the OS picker. */
  outputDir?: string;
}

export function useExport() {
  const setRunning = useExportStatusStore((state) => state.setRunning);
  const setResult = useExportStatusStore((state) => state.setResult);
  const setError = useExportStatusStore((state) => state.setError);
  const running = useExportStatusStore((state) => state.running);

  const runExport = useCallback(
    async (input: RunExportInput): Promise<ExportResult | undefined> => {
      if (running) {
        // We deliberately serialize — running two exports in parallel against
        // the same connection would interleave cursor traffic. The UI should
        // already be disabled, but a hot click could double-fire.
        return undefined;
      }

      let outputDir = input.outputDir;
      if (!outputDir) {
        try {
          outputDir = await window.cassandraDesk.pickExportFolder();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
          return undefined;
        }
        if (!outputDir) {
          // User cancelled the folder picker — silent return; no banner.
          return undefined;
        }
      }

      const request: ExportRequest = { ...input.request, outputDir };
      setRunning(input.summary);
      try {
        const result = await window.cassandraDesk.exportDatabase(request);
        setResult(result);
        return result;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return undefined;
      } finally {
        setRunning(undefined);
      }
    },
    [running, setError, setResult, setRunning],
  );

  return { runExport, running };
}
