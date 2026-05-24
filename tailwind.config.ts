import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        panel: "var(--color-panel)",
        "panel-soft": "var(--color-panel-soft)",
        line: "var(--color-line)",
        "line-soft": "var(--color-line-soft)",
        text: "var(--color-text)",
        muted: "var(--color-muted)",
        subtle: "var(--color-subtle)",
        accent: "var(--color-accent)",
        "accent-soft": "var(--color-accent-soft)",
        danger: "var(--color-danger)",
        warning: "var(--color-warning)",
        success: "var(--color-success)"
      },
      borderRadius: {
        ui: "6px"
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["SF Mono", "JetBrains Mono", "Cascadia Code", "monospace"]
      }
    }
  },
  plugins: []
} satisfies Config;
