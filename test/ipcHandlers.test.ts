import { describe, expect, it, vi } from "vitest";
import { ipcChannels } from "../src/core/ipc";
import { CassandraService } from "../src/core/cassandra/CassandraService";
import { AdapterRegistry } from "../src/main/adapters/AdapterRegistry";
import { CassandraAdapter } from "../src/main/adapters/CassandraAdapter";
import { RedisAdapter } from "../src/main/adapters/RedisAdapter";
import { createIpcHandlerMap } from "../src/main/handlers";
import { ProfileStore } from "../src/main/ProfileStore";

const profile = {
  id: "p1",
  name: "Local",
  type: "cassandra" as const,
  contactPoints: ["127.0.0.1"],
  port: 9042,
  localDataCenter: "datacenter1",
  useTls: false
};

function buildContext(overrides: { store?: Partial<ProfileStore>; cassandra?: Partial<CassandraService> } = {}) {
  const store = (overrides.store ?? {}) as ProfileStore;
  const cassandra = (overrides.cassandra ?? {}) as CassandraService;
  const adapters = new AdapterRegistry();
  adapters.register(new CassandraAdapter(cassandra));
  adapters.register(new RedisAdapter());
  return { store, cassandra, redis: new RedisAdapter(), adapters };
}

describe("IPC handler map", () => {
  it("lists profiles with connection state and schema", async () => {
    const cassandra = {
      isConnected: vi.fn().mockReturnValue(true),
      getSchema: vi.fn().mockReturnValue([{ name: "app", tables: [{ name: "orders" }] }])
    } as unknown as CassandraService;
    const store = {
      list: vi.fn().mockResolvedValue([profile])
    } as unknown as ProfileStore;
    const ctx = buildContext({ store, cassandra });

    const handlers = createIpcHandlerMap(ctx);
    await expect(handlers[ipcChannels.listProfiles]()).resolves.toEqual([
      { ...profile, connected: true, schema: [{ name: "app", tables: [{ name: "orders" }] }] }
    ]);
  });

  it("throws when connecting a missing profile", async () => {
    const store = {
      getWithPassword: vi.fn().mockResolvedValue(undefined)
    } as unknown as ProfileStore;
    const ctx = buildContext({ store });

    const handlers = createIpcHandlerMap(ctx);
    await expect(handlers[ipcChannels.connect]("missing")).rejects.toThrow("Connection profile was not found.");
  });

  it("runs select queries through Cassandra service", async () => {
    const cassandra = {
      runSelectQuery: vi.fn().mockResolvedValue({
        cql: "SELECT * FROM users LIMIT 100",
        columns: ["id"],
        rows: [{ id: "1" }],
        limit: 100
      })
    } as unknown as CassandraService;
    const ctx = buildContext({ cassandra });

    const handlers = createIpcHandlerMap(ctx);
    await expect(handlers[ipcChannels.runSelectQuery]("p1", "SELECT * FROM users")).resolves.toMatchObject({
      cql: "SELECT * FROM users LIMIT 100"
    });
    expect(cassandra.runSelectQuery).toHaveBeenCalledWith("p1", "SELECT * FROM users", undefined);
  });
});
