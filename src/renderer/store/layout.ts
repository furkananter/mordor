import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  CQL_EDITOR_DEFAULT_HEIGHT,
  CQL_EDITOR_MAX_HEIGHT,
  CQL_EDITOR_MIN_HEIGHT,
  MIGRATION_DRAWER_DEFAULT_WIDTH,
  MIGRATION_DRAWER_MAX_WIDTH,
  MIGRATION_DRAWER_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
  clamp,
} from "./constants";
import { WorkspaceTab } from "../features/workspace/WorkspaceTabs";

interface LayoutState {
  activeTab: WorkspaceTab;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  migrationsDrawerWidth: number;
  terminalOpen: boolean;
  terminalHeight: number;
  cqlEditorHeight: number;
}

interface LayoutActions {
  setActiveTab(tab: WorkspaceTab): void;
  toggleSidebar(): void;
  setSidebarWidth(width: number): void;
  setMigrationsDrawerWidth(width: number): void;
  toggleTerminal(): void;
  setTerminalOpen(open: boolean): void;
  setTerminalHeight(height: number): void;
  setCqlEditorHeight(height: number): void;
}

export const useLayoutStore = create<LayoutState & LayoutActions>()(
  persist(
    (set) => ({
      activeTab: "data",
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      migrationsDrawerWidth: MIGRATION_DRAWER_DEFAULT_WIDTH,
      terminalOpen: false,
      terminalHeight: TERMINAL_DEFAULT_HEIGHT,
      cqlEditorHeight: CQL_EDITOR_DEFAULT_HEIGHT,

      setActiveTab: (activeTab) => set({ activeTab }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarWidth: (width) =>
        set({
          sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
        }),
      setMigrationsDrawerWidth: (width) =>
        set({
          migrationsDrawerWidth: clamp(
            width,
            MIGRATION_DRAWER_MIN_WIDTH,
            MIGRATION_DRAWER_MAX_WIDTH,
          ),
        }),
      toggleTerminal: () =>
        set((state) => ({ terminalOpen: !state.terminalOpen })),
      setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
      setTerminalHeight: (height) =>
        set({
          terminalHeight: clamp(
            height,
            TERMINAL_MIN_HEIGHT,
            TERMINAL_MAX_HEIGHT,
          ),
        }),
      setCqlEditorHeight: (height) =>
        set({
          cqlEditorHeight: clamp(
            height,
            CQL_EDITOR_MIN_HEIGHT,
            CQL_EDITOR_MAX_HEIGHT,
          ),
        }),
    }),
    {
      name: "mordor-layout",
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        migrationsDrawerWidth: state.migrationsDrawerWidth,
        terminalHeight: state.terminalHeight,
        cqlEditorHeight: state.cqlEditorHeight,
        activeTab: state.activeTab,
      }),
    },
  ),
);
