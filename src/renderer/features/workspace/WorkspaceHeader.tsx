import { Download, RefreshCw, TerminalSquare } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../../components/ui/Button";
import { useExport } from "../export/useExport";
import { useConnectionStore } from "../../store/connection";
import { useLayoutStore } from "../../store/layout";
import { useRedisStore } from "../../store/redis";
import { useSchemaStore } from "../../store/schema";
import { useStatusStore } from "../../store/status";

export function WorkspaceHeader({ showSettings }: { showSettings: boolean }) {
  // Group store reads through shallow selectors so this component only re-renders
  // when a value we actually display changes — not every time some unrelated
  // slice of the store (e.g. preview rows during live polling) mutates.
  const { profiles, refreshClusterSchema } = useConnectionStore(
    useShallow((state) => ({
      profiles: state.profiles,
      refreshClusterSchema: state.refreshClusterSchema
    }))
  );
  const busy = useStatusStore((state) => state.busy);
  const { selectedTable, selectedProfileId, tableState, reloadSelectedTable } = useSchemaStore(
    useShallow((state) => ({
      selectedTable: state.selectedTable,
      selectedProfileId: state.selectedProfileId,
      tableState: state.tableState,
      reloadSelectedTable: state.reloadSelectedTable
    }))
  );
  const { terminalOpen, toggleTerminal } = useLayoutStore(
    useShallow((state) => ({
      terminalOpen: state.terminalOpen,
      toggleTerminal: state.toggleTerminal
    }))
  );
  const redisSelection = useRedisStore((state) => state.selection);
  const { runExport, running: exportRunning } = useExport();

  // "Export everything" target: pick the most context-rich profile we know
  // about — the table the user is on > the cluster the redis tree is on >
  // whichever profile is selected in the sidebar. Disabled when the resolved
  // profile isn't connected (no live driver session to read from).
  const exportProfileId =
    selectedTable?.profileId ?? redisSelection?.profileId ?? selectedProfileId ?? undefined;
  const exportProfile = exportProfileId
    ? profiles.find((profile) => profile.id === exportProfileId)
    : undefined;
  const canExport = Boolean(exportProfile?.connected) && !exportRunning && !showSettings;
  const handleExportFull = () => {
    if (!exportProfile) return;
    const request: Parameters<typeof runExport>[0]["request"] = {
      profileId: exportProfile.id,
      scope: "full",
    };
    if (exportProfile.type === "redis") {
      request.redisDb = redisSelection?.profileId === exportProfile.id ? redisSelection.db : exportProfile.db;
    }
    void runExport({
      request,
      summary:
        exportProfile.type === "redis"
          ? `Exporting Redis DB ${request.redisDb} (${exportProfile.name})…`
          : `Exporting full ${exportProfile.type} database (${exportProfile.name})…`,
    });
  };

  const handleReload = async () => {
    const profileId = selectedTable?.profileId ?? selectedProfileId;
    const tasks: Promise<unknown>[] = [];
    if (selectedTable) tasks.push(reloadSelectedTable());
    if (profileId) tasks.push(refreshClusterSchema(profileId));
    await Promise.all(tasks);
  };
  const canReload = Boolean(selectedTable || selectedProfileId);

  const connectedCount = profiles.filter((profile) => profile.connected).length;
  const clusterProfileName = selectedProfileId
    ? profiles.find((profile) => profile.id === selectedProfileId)?.name
    : undefined;
  const crumb = showSettings
    ? "Settings"
    : redisSelection
      ? `${redisSelection.profileName} · DB ${redisSelection.db}`
      : selectedTable
        ? `${selectedTable.profileName} / ${selectedTable.keyspace}.${selectedTable.table}`
        : clusterProfileName
          ? `${clusterProfileName} · cluster`
          : "No table selected";

  return (
    <header className="drag-region flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel px-4">
      <span className="truncate text-[12px] text-muted">{crumb}</span>
      <div className="no-drag flex items-center gap-2">
        {busy ? <span className="text-[11.5px] text-muted">{busy}</span> : null}
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${connectedCount > 0 ? "bg-success" : "bg-subtle"}`} />
          {connectedCount} online
        </span>
        <Button
          variant="icon"
          onClick={handleExportFull}
          disabled={!canExport}
          tooltip={
            exportRunning
              ? "Export in progress"
              : exportProfile
                ? `Export ${exportProfile.type === "redis" ? "Redis DB" : "entire database"} (${exportProfile.name})`
                : "Connect to a database to export"
          }
        >
          <Download size={13} strokeWidth={1.7} />
        </Button>
        <Button
          variant="icon"
          onClick={toggleTerminal}
          tooltip="Terminal (⌘J)"
          className={terminalOpen ? "bg-line-soft text-text" : ""}
        >
          <TerminalSquare size={13} strokeWidth={1.7} />
        </Button>
        <Button
          variant="icon"
          onClick={() => void handleReload()}
          disabled={showSettings || !canReload || tableState === "loading"}
          tooltip={
            tableState === "loading"
              ? "Loading"
              : selectedTable
                ? "Reload table + cluster schema"
                : "Reload cluster schema"
          }
        >
          <RefreshCw
            size={13}
            strokeWidth={1.7}
            className={tableState === "loading" ? "animate-spin" : ""}
          />
        </Button>
      </div>
    </header>
  );
}
