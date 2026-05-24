function readColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function buildTerminalTheme() {
  const bg = readColor("--color-panel", "#ffffff");
  const fg = readColor("--color-text", "#2a2724");
  const cursor = readColor("--color-accent", "#c8633a");
  const selection = readColor("--color-line-soft", "#efece5");
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: selection,
    black: "#2a2724",
    red: "#c4453a",
    green: "#4f8a4a",
    yellow: "#b88a2a",
    blue: "#3a6f97",
    magenta: "#8f4f9b",
    cyan: "#3e8a8a",
    white: "#ece8e0",
    brightBlack: "#5e574e",
    brightRed: "#e16e5f",
    brightGreen: "#7aa872",
    brightYellow: "#d4a04a",
    brightBlue: "#7eb3d4",
    brightMagenta: "#c89bd0",
    brightCyan: "#8fc6c6",
    brightWhite: "#faf8f3"
  } as const;
}
