import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom v27 ships Storage methods on the prototype but Zustand's persist
// middleware grabs `localStorage` once and calls `storage.setItem(...)` via
// direct member access — which throws "storage.setItem is not a function"
// the moment any persisted store mutates. Install an own-property shim so
// direct access works and unblocks the persist path (otherwise App.test.tsx
// times out on every test that clicks a table or opens a tab).
if (typeof globalThis.localStorage === "undefined" ||
    typeof globalThis.localStorage.setItem !== "function") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
  if (typeof (globalThis as { window?: { localStorage?: Storage } }).window === "object") {
    Object.defineProperty((globalThis as { window: { localStorage?: Storage } }).window, "localStorage", {
      value: shim,
      writable: true,
      configurable: true,
    });
  }
}

afterEach(() => {
  cleanup();
  // Reset persisted state between tests so one test's tab/layout choice
  // doesn't leak into the next.
  globalThis.localStorage?.clear();
});
