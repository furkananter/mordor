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
  const [booting, setBooting] = useState(true);

  // Side effects + hooks
  useEffect(() => {
    // Boot routine: run local-database detection behind the in-app splash
    // overlay, then drop the overlay to reveal the populated UI. detectLocal()
    // loads profiles as a side effect (detect result, or a listProfiles()
    // fallback), so a separate init() is unnecessary. runWithStatus swallows
    // errors, so the promise always settles — clearing `booting` in finally
    // guarantees the overlay lifts even if detection fails.
    void (async () => {
      try {
        await detectLocal();
      } finally {
        setBooting(false);
      }
    })();
  }, [detectLocal]);
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

  // Handlers
  const handleOpenAdd = () => {
    setEditingProfile(undefined);
    setShowForm(true);
  };
  const handleEditProfile = (profile: ProfileListItem) => {
    setEditingProfile(profile);
    setShowForm(true);
  };
  const handleFormSubmit = async (input: CreateProfileInput) => {
    if (editingProfile) await updateProfile(editingProfile.id, input);
    else await createProfile(input);
  };
  const handleFormClose = () => {
    setShowForm(false);
    setEditingProfile(undefined);
  };
  const handleShowHome = () => {
    setShowSettings(false);
    clearTable();
    clearRedis();
  };
  const handleSelectProfile = (profileId: string) => {
    setShowSettings(false);
    clearRedis();
    selectProfile(profileId);
  };
  const handleOpenRedisDb = (selection: Parameters<typeof openRedisDb>[0]) => {
    setShowSettings(false);
    void openRedisDb(selection);
  };
  const handleOpenTable = async (table: Parameters<typeof openTable>[0]) => {
    setShowSettings(false);
    await openTable(table);
  };

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

      <SplashOverlay done={!booting} />
    </main>
  );
}

/**
 * Full-window boot overlay shown while startup local-database detection runs.
 * Sits above the whole app (not a separate native window) and fades out once
 * `done` flips true, then unmounts so it never intercepts pointer events after
 * boot. Themed with the same tokens as the shell, so it tracks light/dark.
 */
function SplashOverlay({ done }: { done: boolean }) {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setMounted(false), 350);
    return () => window.clearTimeout(id);
  }, [done]);
  if (!mounted) return null;
  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-bg transition-opacity duration-300 ${
        done ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden={done}
    >
      <img
        src="./splash-icon.png"
        alt=""
        width={84}
        height={84}
        className="rounded-[18px] shadow-sm"
      />
      <div className="text-[26px] font-semibold tracking-tight text-text">Mordor</div>
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span>Detecting local databases…</span>
      </div>
    </div>
  );
}
