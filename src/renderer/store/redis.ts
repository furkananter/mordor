import { create } from "zustand";
import { RedisDbStat, RedisKeyEntry, RedisKeyValue } from "../../core/ipc";
import { runWithStatus, useStatusStore } from "./status";
import { useSchemaStore } from "./schema";
import { useLayoutStore } from "./layout";

export interface RedisSelection {
  profileId: string;
  profileName: string;
  db: number;
}

interface RedisState {
  selection: RedisSelection | undefined;
  dbStats: RedisDbStat[];
  pattern: string;
  cursor: string;
  keys: RedisKeyEntry[];
  loading: boolean;
  reachedEnd: boolean;
  selectedKey: RedisKeyValue | undefined;
}

interface RedisActions {
  openDb(selection: RedisSelection): Promise<void>;
  clearSelection(): void;
  reload(): Promise<void>;
  setPattern(pattern: string): void;
  nextPage(): Promise<void>;
  selectKey(key: string): Promise<void>;
  closeKey(): void;
  refreshSelectedKey(): Promise<void>;
  deleteSelectedKey(): Promise<void>;
  setStringValue(value: string, ttlSeconds?: number): Promise<void>;
  refreshDbStats(): Promise<void>;
}

const PAGE_TARGET = 200;

// A monotonic token that lets every scan run see whether a newer scan has started
// after it. Each reload/nextPage increments this; in-flight scans compare and bail
// out before mutating the store. Without this, two concurrent reload() calls
// (Strict Mode double-effect, DB switch + effect both firing, etc.) would both
// append the same keys → duplicates in the list.
let scanToken = 0;

export const useRedisStore = create<RedisState & RedisActions>((set, get) => ({
  selection: undefined,
  dbStats: [],
  pattern: "*",
  cursor: "0",
  keys: [],
  loading: false,
  reachedEnd: false,
  selectedKey: undefined,

  openDb: async (selection) => {
    useSchemaStore.getState().clearTable();
    useLayoutStore.getState().setActiveTab("data");
    set({
      selection,
      keys: [],
      cursor: "0",
      reachedEnd: false,
      selectedKey: undefined,
    });
    await Promise.all([get().refreshDbStats(), get().reload()]);
  },

  clearSelection: () => {
    scanToken += 1; // invalidate any in-flight scans
    set({
      selection: undefined,
      keys: [],
      cursor: "0",
      selectedKey: undefined,
      dbStats: [],
      reachedEnd: false,
    });
  },

  setPattern: (pattern) => {
    set({ pattern });
  },

  reload: async () => {
    const selection = get().selection;
    if (!selection) return;
    scanToken += 1;
    const myToken = scanToken;
    set({ loading: true, keys: [], cursor: "0", reachedEnd: false });
    await runWithStatus("Scanning keys", async () => {
      try {
        await scanUntil(selection, get().pattern, "0", PAGE_TARGET, (batch) => {
          if (myToken !== scanToken) return true; // newer scan superseded us
          const { keys, cursor } = get();
          const merged = mergeKeys(keys, batch.keys);
          set({
            keys: merged,
            cursor: batch.cursor,
            reachedEnd: batch.cursor === "0" || merged.length >= PAGE_TARGET,
          });
          void cursor;
          return get().reachedEnd;
        });
      } finally {
        if (myToken === scanToken) set({ loading: false });
      }
    });
  },

  nextPage: async () => {
    const { selection, cursor, reachedEnd, pattern } = get();
    if (!selection || reachedEnd) return;
    scanToken += 1;
    const myToken = scanToken;
    const startSize = get().keys.length;
    set({ loading: true });
    await runWithStatus("Scanning keys", async () => {
      try {
        await scanUntil(selection, pattern, cursor, PAGE_TARGET, (batch) => {
          if (myToken !== scanToken) return true;
          const current = get();
          const merged = mergeKeys(current.keys, batch.keys);
          set({
            keys: merged,
            cursor: batch.cursor,
            reachedEnd:
              batch.cursor === "0" || merged.length >= startSize + PAGE_TARGET,
          });
          return get().reachedEnd;
        });
      } finally {
        if (myToken === scanToken) set({ loading: false });
      }
    });
  },

  selectKey: async (key) => {
    const selection = get().selection;
    if (!selection) return;
    await runWithStatus(`Loading ${key}`, async () => {
      const value = await window.cassandraDesk.redisGet(
        selection.profileId,
        selection.db,
        key,
      );
      set({ selectedKey: value });
    });
  },

  closeKey: () => set({ selectedKey: undefined }),

  refreshSelectedKey: async () => {
    const key = get().selectedKey?.key;
    if (!key) return;
    await get().selectKey(key);
  },

  deleteSelectedKey: async () => {
    const selection = get().selection;
    const key = get().selectedKey?.key;
    if (!selection || !key) return;
    await runWithStatus(`Deleting ${key}`, async () => {
      await window.cassandraDesk.redisDelete(
        selection.profileId,
        selection.db,
        key,
      );
      set((state) => ({
        selectedKey: undefined,
        keys: state.keys.filter((entry) => entry.key !== key),
      }));
    });
    void get().refreshDbStats();
  },

  setStringValue: async (value, ttlSeconds) => {
    const selection = get().selection;
    const key = get().selectedKey?.key;
    if (!selection || !key) return;
    await runWithStatus(`Saving ${key}`, async () => {
      await window.cassandraDesk.redisSetString(
        selection.profileId,
        selection.db,
        key,
        value,
        ttlSeconds,
      );
    });
    await get().refreshSelectedKey();
  },

  refreshDbStats: async () => {
    const selection = get().selection;
    if (!selection) return;
    try {
      const dbStats = await window.cassandraDesk.redisDbStats(
        selection.profileId,
      );
      set({ dbStats });
    } catch (caught) {
      useStatusStore
        .getState()
        .setError(caught instanceof Error ? caught.message : String(caught));
    }
  },
}));

/**
 * Append-then-dedupe by key. Handles two failure modes simultaneously:
 *   1. Redis SCAN itself may legitimately return duplicate keys across iterations
 *      (especially during dataset rehashing — documented behavior).
 *   2. Our own concurrent reload() / nextPage() races appending the same batch.
 * The latest entry for any given key wins, so type/ttl reflect the most recent read.
 */
function mergeKeys(
  existing: RedisKeyEntry[],
  incoming: RedisKeyEntry[],
): RedisKeyEntry[] {
  const map = new Map<string, RedisKeyEntry>();
  for (const entry of existing) map.set(entry.key, entry);
  for (const entry of incoming) map.set(entry.key, entry);
  return Array.from(map.values());
}

async function scanUntil(
  selection: RedisSelection,
  pattern: string,
  startCursor: string,
  pageTarget: number,
  onBatch: (batch: { cursor: string; keys: RedisKeyEntry[] }) => boolean,
): Promise<void> {
  let cursor = startCursor;
  let collected = 0;
  let iterations = 0;
  do {
    const result = await window.cassandraDesk.redisScan(
      selection.profileId,
      selection.db,
      pattern || "*",
      cursor,
    );
    cursor = result.cursor;
    collected += result.keys.length;
    const done = onBatch(result);
    iterations += 1;
    if (done) return;
    if (collected >= pageTarget) return;
    if (iterations > 50) return;
  } while (cursor !== "0");
}
