import { beforeEach, describe, expect, it } from "vitest";
import {
  QUERY_HISTORY_MAX,
  useQueryHistoryStore,
} from "../src/renderer/store/queryHistory";

function reset(): void {
  useQueryHistoryStore.setState({ history: [], saved: [] });
}

describe("query-history store", () => {
  beforeEach(reset);

  describe("recordRun", () => {
    it("records a run with the expected shape (newest first)", () => {
      useQueryHistoryStore.getState().recordRun({
        profileId: "p1",
        sql: "SELECT 1",
        ranAt: 1000,
        ok: true,
        rowCount: 3,
      });
      const { history } = useQueryHistoryStore.getState();
      expect(history).toHaveLength(1);
      const [entry] = history;
      expect(entry).toMatchObject({
        profileId: "p1",
        sql: "SELECT 1",
        ranAt: 1000,
        ok: true,
        rowCount: 3,
      });
      expect(typeof entry!.id).toBe("string");
      expect(entry!.id.length).toBeGreaterThan(0);
    });

    it("prepends newer runs ahead of older ones", () => {
      const { recordRun } = useQueryHistoryStore.getState();
      recordRun({ profileId: "p1", sql: "FIRST", ranAt: 1, ok: true });
      recordRun({ profileId: "p1", sql: "SECOND", ranAt: 2, ok: false });
      const { history } = useQueryHistoryStore.getState();
      expect(history.map((h) => h.sql)).toEqual(["SECOND", "FIRST"]);
    });

    it("omits rowCount when not provided (exactOptionalPropertyTypes-safe)", () => {
      useQueryHistoryStore
        .getState()
        .recordRun({ profileId: "p1", sql: "X", ranAt: 1, ok: false });
      const [entry] = useQueryHistoryStore.getState().history;
      expect("rowCount" in entry!).toBe(false);
    });

    it("caps history at QUERY_HISTORY_MAX, dropping the oldest", () => {
      const { recordRun } = useQueryHistoryStore.getState();
      for (let i = 0; i < QUERY_HISTORY_MAX + 25; i += 1) {
        recordRun({ profileId: "p1", sql: `q${i}`, ranAt: i, ok: true });
      }
      const { history } = useQueryHistoryStore.getState();
      expect(history).toHaveLength(QUERY_HISTORY_MAX);
      // Newest first: the most recent push is at the front.
      expect(history[0]!.sql).toBe(`q${QUERY_HISTORY_MAX + 24}`);
      // The oldest survivor is the (max+24 - (max-1))-th run.
      expect(history[QUERY_HISTORY_MAX - 1]!.sql).toBe("q25");
    });
  });

  describe("clearHistory", () => {
    it("empties history but leaves saved snippets untouched", () => {
      const store = useQueryHistoryStore.getState();
      store.recordRun({ profileId: "p1", sql: "SELECT 1", ranAt: 1, ok: true });
      store.saveSnippet({ name: "keep", sql: "SELECT 2" });
      useQueryHistoryStore.getState().clearHistory();
      expect(useQueryHistoryStore.getState().history).toHaveLength(0);
      expect(useQueryHistoryStore.getState().saved).toHaveLength(1);
    });
  });

  describe("saved snippets", () => {
    it("saveSnippet stores a snippet with an id", () => {
      useQueryHistoryStore
        .getState()
        .saveSnippet({ name: "users", sql: "SELECT * FROM users", profileId: "p1" });
      const { saved } = useQueryHistoryStore.getState();
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        name: "users",
        sql: "SELECT * FROM users",
        profileId: "p1",
      });
      expect(typeof saved[0]!.id).toBe("string");
    });

    it("saveSnippet omits profileId when not supplied", () => {
      useQueryHistoryStore.getState().saveSnippet({ name: "global", sql: "SELECT 1" });
      const [snippet] = useQueryHistoryStore.getState().saved;
      expect("profileId" in snippet!).toBe(false);
    });

    it("renameSnippet updates only the targeted snippet", () => {
      const store = useQueryHistoryStore.getState();
      store.saveSnippet({ name: "a", sql: "SELECT 1" });
      store.saveSnippet({ name: "b", sql: "SELECT 2" });
      const target = useQueryHistoryStore.getState().saved[0]!;
      useQueryHistoryStore.getState().renameSnippet(target.id, "renamed");
      const { saved } = useQueryHistoryStore.getState();
      expect(saved.find((s) => s.id === target.id)!.name).toBe("renamed");
      expect(saved.find((s) => s.name === "b")).toBeTruthy();
    });

    it("renameSnippet is a no-op for an unknown id", () => {
      useQueryHistoryStore.getState().saveSnippet({ name: "a", sql: "SELECT 1" });
      const before = useQueryHistoryStore.getState().saved;
      useQueryHistoryStore.getState().renameSnippet("nope", "x");
      expect(useQueryHistoryStore.getState().saved).toEqual(before);
    });

    it("deleteSnippet removes the targeted snippet", () => {
      const store = useQueryHistoryStore.getState();
      store.saveSnippet({ name: "a", sql: "SELECT 1" });
      store.saveSnippet({ name: "b", sql: "SELECT 2" });
      const target = useQueryHistoryStore.getState().saved[0]!;
      useQueryHistoryStore.getState().deleteSnippet(target.id);
      const { saved } = useQueryHistoryStore.getState();
      expect(saved).toHaveLength(1);
      expect(saved[0]!.id).not.toBe(target.id);
    });
  });

  it("generates unique ids across records", () => {
    const { recordRun } = useQueryHistoryStore.getState();
    recordRun({ profileId: "p1", sql: "a", ranAt: 1, ok: true });
    recordRun({ profileId: "p1", sql: "b", ranAt: 2, ok: true });
    const ids = useQueryHistoryStore.getState().history.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
