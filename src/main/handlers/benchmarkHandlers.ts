/**
 * IPC handlers for the Cassandra benchmark feature.
 *
 *   - `benchmark:run` — runs a resolved scenario via CassandraService and
 *      pushes a `benchmark:progress` event to the focused window after each
 *      step completes (mirrors the `terminal:data` / `updater:status` push
 *      pattern — see TerminalService/UpdaterService).
 *   - `benchmark:export-report` — writes the before/after Markdown report
 *      into a folder the user already picked (reuses the existing
 *      `export:pick-folder` dialog from the renderer side; no new dialog
 *      code here).
 */

import { BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BenchmarkRunResult, ResolvedBenchmarkStep } from "../../core/cassandra/benchmark";
import { BenchmarkComparisonInput, buildBenchmarkComparisonMarkdown } from "../../core/cassandra/benchmarkReport";
import { CassandraService } from "../../core/cassandra/CassandraService";
import { QueryMode } from "../../core/cassandra/query";
import { folderSlug, timestampSuffix } from "../../core/export/formatters";
import { ipcChannels } from "../../core/ipc";

export function createBenchmarkHandlers(cassandra: CassandraService) {
  return {
    [ipcChannels.runBenchmark]: async (
      profileId: string,
      steps: ResolvedBenchmarkStep[],
      mode: QueryMode,
    ): Promise<BenchmarkRunResult> => {
      const total = steps.length;
      let index = 0;
      return cassandra.runBenchmarkScenario(profileId, steps, mode, (result) => {
        index += 1;
        BrowserWindow.getFocusedWindow()?.webContents.send("benchmark:progress", {
          stepId: result.stepId,
          index,
          total,
        });
      });
    },

    [ipcChannels.exportBenchmarkReport]: async (
      outputDir: string,
      report: BenchmarkComparisonInput,
    ): Promise<{ filePath: string }> => {
      if (!outputDir) throw new Error("Export failed: no output folder was supplied.");
      const markdown = buildBenchmarkComparisonMarkdown(report);
      const fileName = `benchmark-compare-${folderSlug(report.scenarioName)}-${timestampSuffix()}.md`;
      const filePath = join(outputDir, fileName);
      await mkdir(outputDir, { recursive: true });
      await writeFile(filePath, markdown, "utf-8");
      return { filePath };
    },
  };
}
