import { useEffect } from "react";
import { FONT_SCALE_FACTORS, FontScale, ThemePreference } from "../store/constants";

export function useThemeSync(themePreference: ThemePreference, fontScale: FontScale): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const resolvedTheme = themePreference === "auto" ? (media?.matches ? "dark" : "light") : themePreference;
      root.dataset.theme = resolvedTheme;
      root.dataset.themePreference = themePreference;
    };
    syncTheme();
    media?.addEventListener("change", syncTheme);
    return () => media?.removeEventListener("change", syncTheme);
  }, [themePreference]);

  useEffect(() => {
    window.cassandraDesk.setZoomFactor(FONT_SCALE_FACTORS[fontScale]);
  }, [fontScale]);
}
