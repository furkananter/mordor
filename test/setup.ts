import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom v27 ships a localStorage object whose Storage methods (setItem/getItem
// /removeItem) live on the prototype but aren't picked up by Zustand's
// `persist` middleware when it grabs `localStorage` off the window. Zustand
// snapshots the storage reference at store-creation time and calls
// `storage.setItem(...)` directly — which throws "storage.setItem is not a
// function" the moment any persisted store mutates (`useLayoutStore` ⇒
// every Tab change, table click, etc.). Installing an own-property shim makes
// the methods visible to direct member access and unblocks the persist path.
// (Without this, `App.test.tsx` times out on every test that clicks a table.)
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
  // Mirror onto window when the test runs in jsdom — Zustand reads from there.
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
  // Reset persisted layout/store state between tests so one test's tab choice
  // doesn't bleed into the next ("renders saved connections" expects the Data
  // tab on first paint; a leftover "cql" from another test breaks it).
  globalThis.localStorage?.clear();
});
