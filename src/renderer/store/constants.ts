export type LoadState = "idle" | "loading" | "loaded";
export type ConnectionListFilter = "all" | "online" | "offline";
export type ThemePreference = "dark" | "light" | "auto";
export type FontScale = "small" | "normal" | "large";
export type QueryMode = "read" | "write" | "all";

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 500;

export const LIVE_INTERVAL_OPTIONS_MS = [
  1000, 2000, 5000, 10000, 30000,
] as const;
export type LiveIntervalMs = (typeof LIVE_INTERVAL_OPTIONS_MS)[number];
// 2s is the default now that the live tick only commits a re-render when the
// fetched page actually differs (previewsEqual guard in refreshPreviewSilent).
// An idle table costs one cheap diff per tick and zero React work; the heavy
// re-render the old 5s default was avoiding only happens when data really
// changed — which is exactly when you want to see it. Users can still drop to
// 1s or back off to 30s from the select.
export const DEFAULT_LIVE_INTERVAL_MS: LiveIntervalMs = 2000;

export const FONT_SCALE_FACTORS: Record<FontScale, number> = {
  small: 0.9,
  normal: 1,
  large: 1.15,
};

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 280;

export const MIGRATION_DRAWER_MIN_WIDTH = 360;
export const MIGRATION_DRAWER_MAX_WIDTH = 1100;
export const MIGRATION_DRAWER_DEFAULT_WIDTH = 720;

export const TERMINAL_MIN_HEIGHT = 140;
export const TERMINAL_MAX_HEIGHT = 600;
export const TERMINAL_DEFAULT_HEIGHT = 260;

export const CQL_EDITOR_MIN_HEIGHT = 120;
export const CQL_EDITOR_MAX_HEIGHT = 640;
export const CQL_EDITOR_DEFAULT_HEIGHT = 240;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
