import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { useQueryStore } from "../src/renderer/store/query";
import { CassandraDeskApi } from "../src/core/ipc";

const api: CassandraDeskApi = {
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  detectLocalConnections: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  refreshSchema: vi.fn(),
  getTableSchema: vi.fn(),
  getPreview: vi.fn(),
  runSelectQuery: vi.fn(),
  deleteTableRows: vi.fn(),
  getTableDdl: vi.fn(),
  runSchemaScript: vi.fn(),
  pickMigrationsFolder: vi.fn(),
  listMigrations: vi.fn(),
  previewMigration: vi.fn(),
  createMigration: vi.fn(),
  readMigrationFile: vi.fn(),
  writeMigrationFile: vi.fn(),
  applyMigration: vi.fn(),
  ensureMigrationTable: vi.fn(),
  setZoomFactor: vi.fn(),
  onFullscreenChange: vi.fn(() => () => undefined),
  terminalCreate: vi.fn(),
  terminalWrite: vi.fn(),
  terminalResize: vi.fn(),
  terminalKill: vi.fn(),
  onTerminalData: vi.fn(() => () => undefined),
  onTerminalExit: vi.fn(() => () => undefined),
  redisDbStats: vi.fn(),
  redisScan: vi.fn(),
  redisGet: vi.fn(),
  redisDelete: vi.fn(),
  redisSetString: vi.fn(),
  redisCommand: vi.fn()
};

const profile = {
  id: "p1",
  name: "Local",
  type: "cassandra" as const,
  contactPoints: ["127.0.0.1"],
  port: 9042,
  localDataCenter: "datacenter1",
  useTls: false,
  connected: true,
  schema: [{ name: "app", tables: [{ name: "orders" }] }]
};

beforeEach(() => {
  vi.resetAllMocks();
  window.cassandraDesk = api;
  vi.mocked(api.listProfiles).mockResolvedValue([profile]);
  vi.mocked(api.getTableSchema).mockResolvedValue({
    table: { profileId: "p1", profileName: "Local", keyspace: "app", table: "orders" },
    columns: [
      { name: "id", type: "uuid", kind: "partition_key", position: 0 },
      { name: "total", type: "decimal", kind: "regular", position: null }
    ],
    partitionKeys: ["id"],
    clusteringKeys: []
  });
  vi.mocked(api.getPreview).mockResolvedValue({
    columns: ["id", "total"],
    rows: [{ id: "abc", total: "12.5" }],
    limit: 100
  });
  vi.mocked(api.runSelectQuery).mockResolvedValue({
    cql: "SELECT * FROM users LIMIT 100",
    columns: ["id"],
    rows: [{ id: "1" }],
    limit: 100
  });
});

describe("Cassandra Desk renderer", () => {
  it("renders saved connections and auto-loads table preview", async () => {
    render(<App />);

    expect((await screen.findAllByText("Local")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "orders" }));

    // The workspace routes are code-split via React.lazy now; give Vitest's
    // dynamic import resolver a generous window before assertions.
    expect(await screen.findByText(/app\.orders/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(
      await screen.findByRole("columnheader", { name: "id" }, { timeout: 5000 })
    ).toBeInTheDocument();
    expect(await screen.findByText("12.5", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(api.getTableSchema).toHaveBeenCalled();
    expect(api.getPreview).toHaveBeenCalled();
    expect(screen.getByLabelText("Schema inspector")).toBeInTheDocument();
  });

  it("shows connection form and sends profile creation through preload API", async () => {
    vi.mocked(api.createProfile).mockResolvedValue([profile]);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dev" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save connection" }).closest("form")!);

    await waitFor(() => expect(api.createProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Dev" })));
  });

  it("shows errors from main process operations", async () => {
    vi.mocked(api.listProfiles).mockRejectedValue(new Error("Config is unreadable."));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Config is unreadable.");
  });

  it("runs a CQL query from the CQL tab", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "orders" }, { timeout: 5000 }));
    await screen.findByRole("columnheader", { name: "id" }, { timeout: 5000 });

    fireEvent.click(screen.getByRole("tab", { name: "CQL" }));
    act(() => useQueryStore.getState().setQueryText("SELECT * FROM users"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(api.runSelectQuery).toHaveBeenCalledWith("p1", "SELECT * FROM users", "read"));
    expect(await screen.findByText("SELECT * FROM users LIMIT 100", undefined, { timeout: 5000 })).toBeInTheDocument();
  });
});
