import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSchemaStore } from "../src/renderer/store/schema";
import type { PreviewRowsPayload, TableIdentity } from "../src/core/shared/messages";

// Regression guard for the live-polling bug: the old refreshPreviewLive only
// prepended rows with brand-new primary keys, so edits to existing rows showed
// stale values and deletes lingered until an app restart. The live tick now
// swaps the whole first page in (refreshPreviewSilent), reflecting every change.

const table: TableIdentity = {
  profileId: "p1",
  profileName: "Local",
  keyspace: "app",
  table: "orders",
};

const getPreview = vi.fn();

function preview(rows: Record<string, string>[]): PreviewRowsPayload {
  return { columns: ["id", "total"], rows, limit: 100 };
}

beforeEach(() => {
  getPreview.mockReset();
  (window as unknown as { cassandraDesk: { getPreview: typeof getPreview } }).cassandraDesk = {
    getPreview,
  };
  useSchemaStore.setState({
    selectedTable: table,
    selectedProfileId: table.profileId,
    schema: undefined,
    preview: undefined,
    tableState: "loaded",
  });
});

describe("live refresh (refreshPreviewSilent)", () => {
  it("reflects an updated row value", async () => {
    useSchemaStore.setState({ preview: preview([{ id: "a", total: "10" }]) });
    getPreview.mockResolvedValue(preview([{ id: "a", total: "99" }]));
    await useSchemaStore.getState().refreshPreviewSilent();
    expect(useSchemaStore.getState().preview?.rows).toEqual([{ id: "a", total: "99" }]);
  });

  it("reflects a deleted row", async () => {
    useSchemaStore.setState({
      preview: preview([
        { id: "a", total: "10" },
        { id: "b", total: "20" },
      ]),
    });
    getPreview.mockResolvedValue(preview([{ id: "a", total: "10" }]));
    await useSchemaStore.getState().refreshPreviewSilent();
    expect(useSchemaStore.getState().preview?.rows).toEqual([{ id: "a", total: "10" }]);
  });

  it("reflects an inserted row", async () => {
    useSchemaStore.setState({ preview: preview([{ id: "a", total: "10" }]) });
    getPreview.mockResolvedValue(
      preview([
        { id: "a", total: "10" },
        { id: "b", total: "20" },
      ]),
    );
    await useSchemaStore.getState().refreshPreviewSilent();
    expect(useSchemaStore.getState().preview?.rows).toHaveLength(2);
  });

  it("skips the state swap when nothing changed (no needless re-render)", async () => {
    const initial = preview([{ id: "a", total: "10" }]);
    useSchemaStore.setState({ preview: initial });
    getPreview.mockResolvedValue(preview([{ id: "a", total: "10" }]));
    await useSchemaStore.getState().refreshPreviewSilent();
    // Same object reference => Zustand subscribers don't re-render.
    expect(useSchemaStore.getState().preview).toBe(initial);
  });
});
