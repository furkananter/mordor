import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react({})],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  root: ".",
  base: "./",
  server: {
    port: 5273,
    strictPort: true
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: "index.html",
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
        // Manual vendor split. The goal is two-fold:
        //   1. Keep the initial `index.js` lean by parking large third-party
        //      libs in their own chunks so the first paint only parses app code.
        //   2. Cache vendor chunks across releases — bumping app code shouldn't
        //      force users to redownload React / Radix / TanStack on every update.
        // Anything not listed here stays in the default chunking (lazy routes
        // already get their own chunks).
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || /\bnode_modules\/react\//.test(id) || id.includes("scheduler")) {
            return "vendor-react";
          }
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("@tanstack")) return "vendor-tanstack";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (id.includes("zustand")) return "vendor-zustand";
          if (id.includes("@codemirror") || id.includes("@uiw/react-codemirror") || id.includes("@lezer")) {
            return "vendor-codemirror";
          }
          if (id.includes("@xterm")) return "vendor-xterm";
          return undefined;
        }
      }
    }
  }
});
