import { useCallback, useEffect, useState } from "react";
import { CreateProfileInput, ProfileListItem } from "../core/ipc";
import { ConnectionFormDialog } from "./features/connections/ConnectionFormDialog";
import { Sidebar } from "./features/sidebar/Sidebar";
import { UpdateBanner } from "./features/updates/UpdateBanner";
import { TerminalDrawer } from "./features/workspace/TerminalDrawer";
import { WorkspaceHeader } from "./features/workspace/WorkspaceHeader";
import { WorkspaceRoutes } from "./features/workspace/WorkspaceRoutes";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useDragHandle } from "./hooks/useDragHandle";
import { useFullscreen } from "./hooks/useFullscreen";
import { useThemeSync } from "./hooks/useThemeSync";
import { PerfZone } from "./lib/perf";
import { useConnectionStore } from "./store/connection";
import { useLayoutStore } from "./store/layout";
import { usePreferencesStore } from "./store/preferences";
import { useRedisStore } from "./store/redis";
import { useSchemaStore } from "./store/schema";
import { useStatusStore } from "./store/status";
import { useUpdaterStore } from "./store/updater";

export function App() {
  // Stores
  const profiles = useConnectionStore((state) => state.profiles);
  const init = useConnectionStore((state) => state.init);
  const detectLocal = useConnectionStore((state) => state.detectLocal);
  const createProfile = useConnectionStore((state) => state.createProfile);
  const updateProfile = useConnectionStore((state) => state.updateProfile);
  const deleteProfile = useConnectionStore((state) => state.deleteProfile);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);

  const selectedTable = useSchemaStore((state) => state.selectedTable);
  const selectedProfileId = useSchemaStore((state) => state.selectedProfileId);
  const openTable = useSchemaStore((state) => state.openTable);
  const selectProfile = useSchemaStore((state) => state.selectProfile);
  const clearTable = useSchemaStore((state) => state.clearTable);

  const redisSelection = useRedisStore((state) => state.selection);
  const openRedisDb = useRedisStore((state) => state.openDb);
  const clearRedis = useRedisStore((state) => state.clearSelection);

  const sidebarCollapsed = useLayoutStore((state) => state.sidebarCollapsed);
  const sidebarWidth = useLayoutStore((state) => state.sidebarWidth);
  const setSidebarWidth = useLayoutStore((state) => state.setSidebarWidth);
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar);
  const toggleTerminal = useLayoutStore((state) => state.toggleTerminal);

  const themePreference = usePreferencesStore((state) => state.themePreference);
  const fontScale = usePreferencesStore((state) => state.fontScale);

  const busy = useStatusStore((state) => state.busy);
  const error = useStatusStore((state) => state.error);
  const showForm = useStatusStore((state) => state.showForm);
  const setShowForm = useStatusStore((state) => state.setShowForm);

  const initUpdater = useUpdaterStore((state) => state.init);

  // App-level state
  const [showSettings, setShowSettings] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileListItem | undefined>(undefined);

  // Side effects + hooks
  useEffect(() => {
    // Defer the profile fetch off the first paint. The Sidebar renders an
    // empty list until profiles arrive a tick later, which keeps the initial
    // commit small. requestIdleCallback when available, otherwise a tiny
    // setTimeout so the IPC round-trip doesn't extend the first frame.
    // Local detection is user-driven (Detect button) — running it on boot
    // tarpits the app for 5-15 s on cold start when Docker / DB probes time
    // out, which makes the packaged build feel broken.
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    });
    const handle = idle.requestIdleCallback
      ? idle.requestIdleCallback(() => void init(), { timeout: 400 })
      : window.setTimeout(() => void init(), 0);
    return () => {
      if (idle.cancelIdleCallback && idle.requestIdleCallback) idle.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [init]);
  useEffect(() => {
    // Same idle deferral pattern: the updater state machine pulls its initial
    // snapshot over IPC and subscribes to pushes. Pushed status changes drive
    // the UpdateBanner — nothing on the critical-path render depends on it,
    // so it can wait until after first paint.
    void initUpdater();
  }, [initUpdater]);
  useThemeSync(themePreference, fontScale);
  useAppShortcuts({ onToggleTerminal: toggleTerminal });
  const fullscreen = useFullscreen();
  const sidebarDrag = useDragHandle(
    "x",
    useCallback((clientX: number) => setSidebarWidth(clientX), [setSidebarWidth]),
    { disabled: sidebarCollapsed }
  );

  // Handlers — wrapped in useCallback so the deep tree (sidebar's connection
  // nodes, each with hundreds of memoized TableRow children) doesn't see a
  // fresh closure on every App render. Without this, React.memo on TableRow
  // would re-render every row whenever any unrelated state in App changes
  // (modal toggle, busy flag, etc.).
  const handleOpenAdd = useCallback(() => {
    setEditingProfile(undefined);
    setShowForm(true);
  }, [setShowForm]);
  const handleEditProfile = useCallback((profile: ProfileListItem) => {
    setEditingProfile(profile);
    setShowForm(true);
  }, [setShowForm]);
  const handleFormSubmit = useCallback(async (input: CreateProfileInput) => {
    if (editingProfile) await updateProfile(editingProfile.id, input);
    else await createProfile(input);
  }, [editingProfile, updateProfile, createProfile]);
  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingProfile(undefined);
  }, [setShowForm]);
  const handleShowHome = useCallback(() => {
    setShowSettings(false);
    clearTable();
    clearRedis();
  }, [clearTable, clearRedis]);
  const handleSelectProfile = useCallback((profileId: string) => {
    setShowSettings(false);
    clearRedis();
    selectProfile(profileId);
  }, [clearRedis, selectProfile]);
  const handleOpenRedisDb = useCallback((selection: Parameters<typeof openRedisDb>[0]) => {
    setShowSettings(false);
    void openRedisDb(selection);
  }, [openRedisDb]);
  const handleOpenTable = useCallback(async (table: Parameters<typeof openTable>[0]) => {
    setShowSettings(false);
    await openTable(table);
  }, [openTable]);

  return (
    <main
      className="app-shell grid h-full bg-bg text-text"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      data-resizing={sidebarDrag.resizing ? "true" : "false"}
      data-fullscreen={fullscreen ? "true" : "false"}
      style={{ ["--sidebar-width" as string]: `${sidebarWidth}px` }}
    >
      <PerfZone id="sidebar">
        <Sidebar
          profiles={profiles}
          selectedTable={selectedTable}
          selectedProfileId={selectedProfileId}
          busy={busy}
          collapsed={sidebarCollapsed}
          showSettings={showSettings}
          onDetectLocal={detectLocal}
          onAddConnection={handleOpenAdd}
          onEditConnection={handleEditProfile}
          onDeleteConnection={deleteProfile}
          onShowSettings={() => setShowSettings(true)}
          onShowHome={handleShowHome}
          onSelectProfile={handleSelectProfile}
          selectedRedis={redisSelection}
          onOpenRedisDb={handleOpenRedisDb}
          onToggleCollapsed={toggleSidebar}
          onResizeStart={sidebarDrag.onMouseDown}
          resizing={sidebarDrag.resizing}
          onConnect={connect}
          onDisconnect={disconnect}
          onOpenTable={handleOpenTable}
        />
      </PerfZone>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden" aria-label="Workspace">
        <WorkspaceHeader showSettings={showSettings} />

        {/* Update notice renders as a fixed toast (top-right) — no longer in
            normal flow, so it doesn't reflow the workspace when it appears. */}
        <UpdateBanner />

        {error ? (
          <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-[12px] text-danger" role="alert">
            {error}
          </div>
        ) : null}

        <PerfZone id="workspace">
          <WorkspaceRoutes
            showSettings={showSettings}
            onAddConnection={handleOpenAdd}
            onEditConnection={handleEditProfile}
            onOpenTable={handleOpenTable}
          />
        </PerfZone>

        <TerminalDrawer />
      </section>

      <ConnectionFormDialog
        open={showForm}
        editing={editingProfile}
        onSubmit={handleFormSubmit}
        onClose={handleFormClose}
      />
    </main>
  );
}
