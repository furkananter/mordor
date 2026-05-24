import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_LIVE_INTERVAL_MS,
  DEFAULT_PAGE_SIZE,
  FontScale,
  LiveIntervalMs,
  PageSize,
  QueryMode,
  ThemePreference,
} from "./constants";

interface PreferencesState {
  themePreference: ThemePreference;
  fontScale: FontScale;
  queryMode: QueryMode;
  pageSize: PageSize;
  liveIntervalMs: LiveIntervalMs;
}

interface PreferencesActions {
  setThemePreference(themePreference: ThemePreference): void;
  setFontScale(fontScale: FontScale): void;
  setQueryMode(queryMode: QueryMode): void;
  setPageSize(pageSize: PageSize): void;
  setLiveIntervalMs(liveIntervalMs: LiveIntervalMs): void;
}

export const usePreferencesStore = create<
  PreferencesState & PreferencesActions
>()(
  persist(
    (set) => ({
      themePreference: "auto",
      fontScale: "normal",
      queryMode: "read",
      pageSize: DEFAULT_PAGE_SIZE,
      liveIntervalMs: DEFAULT_LIVE_INTERVAL_MS,
      setThemePreference: (themePreference) => set({ themePreference }),
      setFontScale: (fontScale) => set({ fontScale }),
      setQueryMode: (queryMode) => set({ queryMode }),
      setPageSize: (pageSize) => set({ pageSize }),
      setLiveIntervalMs: (liveIntervalMs) => set({ liveIntervalMs }),
    }),
    { name: "mordor-preferences" },
  ),
);
