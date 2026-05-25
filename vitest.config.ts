import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({})],
  define: {
    __APP_VERSION__: JSON.stringify("test")
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // Vitest's default 5 s per test is tight for the App.test.tsx flows that
    // click into the lazy-loaded TableWorkspace + CqlEditor chunks and then
    // wait for IPC mock chains to resolve. macOS GitHub runners are
    // noticeably slower than Linux for esbuild/Vite chunk transformation —
    // the same test that finishes in ~250 ms locally runs ~3-4 s there and
    // occasionally crosses 5 s. Bumping to 15 s eliminates the flake without
    // hiding a real hang (a stuck test will still fail in well under 30 s).
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
