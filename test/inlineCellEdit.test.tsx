import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataTable, DataTableInlineEditConfig } from "../src/renderer/components/ui/data-table/DataTable";
import type { DataTablePayload } from "../src/renderer/components/ui/data-table/types";

// Stream 4 — inline (double-click) cell editing. These exercise the
// DataTableBody editing affordance directly: PK columns aren't editable, a
// double-click on a data cell opens an input, Enter commits the changed value
// through onCommit, and Esc discards it.

const result: DataTablePayload = {
  columns: ["id", "name", "active"],
  rows: [{ id: "1", name: "Ada", active: "true" }]
};

function renderTable(config: DataTableInlineEditConfig, columnTypes?: Record<string, string>) {
  return render(
    <DataTable
      result={result}
      loading={false}
      emptyTitle="none"
      emptyBody="none"
      rowIdColumns={["id"]}
      inlineEditConfig={config}
      {...(columnTypes ? { columnTypes } : {})}
    />
  );
}

function baseConfig(onCommit = vi.fn().mockResolvedValue(undefined)): DataTableInlineEditConfig {
  return {
    enabled: true,
    editableColumn: (column) => column !== "id",
    onCommit
  };
}

describe("inline cell editing", () => {
  it("double-clicking a data cell opens an editor and Enter commits the new value", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderTable(baseConfig(onCommit));

    const cell = screen.getByText("Ada");
    fireEvent.doubleClick(cell);

    const input = await screen.findByDisplayValue("Ada");
    fireEvent.change(input, { target: { value: "Grace" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit).toHaveBeenCalledWith(
      { id: "1", name: "Ada", active: "true" },
      "name",
      "Grace"
    );
  });

  it("Esc cancels without committing", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderTable(baseConfig(onCommit));

    fireEvent.doubleClick(screen.getByText("Ada"));
    const input = await screen.findByDisplayValue("Ada");
    fireEvent.change(input, { target: { value: "Grace" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(screen.queryByDisplayValue("Grace")).toBeNull());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not open an editor on a primary-key column", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderTable(baseConfig(onCommit));

    // The id cell carries the "Double-click to edit" title only when editable;
    // since "1" also appears in the pagination footer, scope to the data cell.
    const idCell = screen.getAllByText("1").find((node) => node.closest("td"));
    expect(idCell).toBeTruthy();
    fireEvent.doubleClick(idCell!);
    await Promise.resolve();
    expect(screen.queryByDisplayValue("1")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit when the value is unchanged", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderTable(baseConfig(onCommit));

    fireEvent.doubleClick(screen.getByText("Ada"));
    const input = await screen.findByDisplayValue("Ada");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.queryByDisplayValue("Ada")).toBeNull());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("renders a boolean select for boolean-typed columns", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderTable(baseConfig(onCommit), { active: "boolean" });

    fireEvent.doubleClick(screen.getByText("true"));
    const select = (await screen.findByDisplayValue("true")) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "false" } });
    fireEvent.keyDown(select, { key: "Enter" });

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(
      { id: "1", name: "Ada", active: "true" },
      "active",
      "false"
    ));
  });

  it("keeps the editor open after a failed commit and allows a retry", async () => {
    const onCommit = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    renderTable(baseConfig(onCommit));

    fireEvent.doubleClick(screen.getByText("Ada"));
    const input = await screen.findByDisplayValue("Ada");
    fireEvent.change(input, { target: { value: "Grace" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // First commit rejected → editor stays open for a retry.
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const retryInput = await screen.findByDisplayValue("Grace");

    // A second edit + Enter must re-arm the commit guard and call onCommit again.
    fireEvent.change(retryInput, { target: { value: "Hopper" } });
    fireEvent.keyDown(retryInput, { key: "Enter" });

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(2));
    expect(onCommit).toHaveBeenLastCalledWith(
      { id: "1", name: "Ada", active: "true" },
      "name",
      "Hopper"
    );
    await waitFor(() => expect(screen.queryByDisplayValue("Hopper")).toBeNull());
  });

  it("does not open an editor when disabled", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderTable({ ...baseConfig(onCommit), enabled: false });

    fireEvent.doubleClick(screen.getByText("Ada"));
    await Promise.resolve();
    expect(screen.queryByDisplayValue("Ada")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
