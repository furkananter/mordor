import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfilePreviewCache, useSchemaStore } from "../src/renderer/store/schema";
import type {
  PreviewQuery,
  PreviewRowsPayload,
  TableIdentity,
  TableSchemaPayload,
} from "../src/core/shared/messages";

// Regression guard for the cache-poisoning bug: paging or live-polling a
// filtered (serverQuery-active) view used to write the filtered rows into the
// shared unfiltered preview cache, so a later plain openTable surfaced the
// filtered subset. Paging/live-refresh now only refresh the cache when no
// serverQuery is active (mirroring applyServerQuery's no-cache-when-filtered
// policy).

const table: TableIdentity = {
  profileId: "p1",
  profileName: "Local",
  keyspace: "app",
  table: "orders",
};

const getPreview = vi.fn();
const getTableSchema = vi.fn();

function preview(
  rows: Record<string, string>[],
  pageState?: string,
): PreviewRowsPayload {
  const payload: PreviewRowsPayload = { columns: ["id", "total"], rows, limit: 100 };
  if (pageState) payload.pageState = pageState;
  return payload;
}

const filter: PreviewQuery = { filters: [{ column: "total", op: "gt", value: "50" }] };

beforeEach(() => {
  // The preview cache is module-level state; clear it so entries written by a
  // prior test can't satisfy this test's openTable and mask a fresh fetch.
  clearProfilePreviewCache(table.profileId);
  getPreview.mockReset();
  getTableSchema.mockReset();
  getTableSchema.mockResolvedValue({} as TableSchemaPayload);
  (
    window as unknown as {
      cassandraDesk: { getPreview: typeof getPreview; getTableSchema: typeof getTableSchema };
    }
  ).cassandraDesk = { getPreview, getTableSchema };
  useSchemaStore.setState({
    selectedTable: table,
    selectedProfileId: table.profileId,
    schema: undefined,
    preview: undefined,
    tableState: "loaded",
    serverQuery: undefined,
  });
});

describe("preview cache poisoning (server-side filter)", () => {
  it("does not poison the unfiltered cache when paging a filtered view", async () => {
    // First page of the filtered result, with a page state so we can load more.
    useSchemaStore.setState({
      serverQuery: filter,
      preview: preview([{ id: "b", total: "60" }], "cursor-1"),
    });
    // loadMorePreview returns the second filtered page.
    getPreview.mockResolvedValueOnce(preview([{ id: "c", total: "70" }]));
    await useSchemaStore.getState().loadMorePreview();

    // Now clear the filter and open the table plainly. The cache must NOT hand
    // back the filtered rows — openTable should issue a fresh unfiltered fetch.
    getPreview.mockResolvedValueOnce(
      preview([
        { id: "a", total: "10" },
        { id: "b", total: "60" },
        { id: "c", total: "70" },
      ]),
    );
    await useSchemaStore.getState().openTable(table);

    expect(getPreview).toHaveBeenLastCalledWith(table);
    expect(useSchemaStore.getState().preview?.rows).toHaveLength(3);
  });

  it("does not poison the unfiltered cache when live-refreshing a filtered view", async () => {
    useSchemaStore.setState({
      serverQuery: filter,
      preview: preview([{ id: "b", total: "60" }]),
    });
    getPreview.mockResolvedValueOnce(preview([{ id: "b", total: "65" }]));
    await useSchemaStore.getState().refreshPreviewSilent();

    // A subsequent plain open must re-fetch rather than serve the cached
    // filtered page.
    getPreview.mockResolvedValueOnce(
      preview([
        { id: "a", total: "10" },
        { id: "b", total: "65" },
      ]),
    );
    await useSchemaStore.getState().openTable(table);

    expect(getPreview).toHaveBeenLastCalledWith(table);
    expect(useSchemaStore.getState().preview?.rows).toHaveLength(2);
  });

  it("still caches paging results for the plain unfiltered view", async () => {
    useSchemaStore.setState({
      serverQuery: undefined,
      preview: preview([{ id: "a", total: "10" }], "cursor-1"),
    });
    getPreview.mockResolvedValueOnce(preview([{ id: "b", total: "20" }]));
    await useSchemaStore.getState().loadMorePreview();

    // Reopening the table should serve the merged page from cache without a
    // fresh getPreview fetch.
    const callsBefore = getPreview.mock.calls.length;
    await useSchemaStore.getState().openTable(table);
    expect(getPreview.mock.calls.length).toBe(callsBefore);
    expect(useSchemaStore.getState().preview?.rows).toHaveLength(2);
  });
});
