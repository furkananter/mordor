import { describe, expect, it, vi } from "vitest";
import { ipcChannels } from "../src/core/ipc";
import { CassandraService } from "../src/core/cassandra/CassandraService";
import { PostgresService } from "../src/core/postgres/PostgresService";
import { AdapterRegistry } from "../src/main/adapters/AdapterRegistry";
import { CassandraAdapter } from "../src/main/adapters/CassandraAdapter";
import { PostgresAdapter } from "../src/main/adapters/PostgresAdapter";
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

function buildContext(overrides: {
  store?: Partial<ProfileStore>;
  cassandra?: Partial<CassandraService>;
  postgres?: Partial<PostgresService>;
} = {}) {
  const store = (overrides.store ?? {}) as ProfileStore;
  const cassandra = (overrides.cassandra ?? {}) as CassandraService;
  const postgres = (overrides.postgres ?? {}) as PostgresService;
  const adapters = new AdapterRegistry();
  adapters.register(new CassandraAdapter(cassandra));
  adapters.register(new PostgresAdapter(postgres));
  adapters.register(new RedisAdapter());
  return { store, cassandra, postgres, redis: new RedisAdapter(), adapters };
}

describe("IPC handler map", () => {
  it("lists profiles with connection state and schema", async () => {
    const keyspaces = [{ name: "app", tables: [{ name: "orders" }] }];
    const cassandra = {
      isConnected: vi.fn().mockReturnValue(true),
      // CassandraService.getSchema still returns KeyspaceNode[] — the adapter
      // is the layer that wraps it into the tagged-union AdapterSchema.
      getSchema: vi.fn().mockReturnValue(keyspaces)
    } as unknown as CassandraService;
    const store = {
      list: vi.fn().mockResolvedValue([profile])
    } as unknown as ProfileStore;
    const ctx = buildContext({ store, cassandra });

    const handlers = createIpcHandlerMap(ctx);
    await expect(handlers[ipcChannels.listProfiles]()).resolves.toEqual([
      { ...profile, connected: true, schema: { kind: "cassandra", keyspaces } }
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
    // Schema handlers now dispatch on profile.type, so the store needs to
    // surface the profile for the query path to know which service to call.
    const store = {
      get: vi.fn().mockResolvedValue(profile)
    } as unknown as ProfileStore;
    const ctx = buildContext({ cassandra, store });

    const handlers = createIpcHandlerMap(ctx);
    await expect(handlers[ipcChannels.runSelectQuery]("p1", "SELECT * FROM users")).resolves.toMatchObject({
      cql: "SELECT * FROM users LIMIT 100"
    });
    expect(cassandra.runSelectQuery).toHaveBeenCalledWith("p1", "SELECT * FROM users", undefined);
  });

  it("updates a row through the service matching the profile type", async () => {
    const table = { profileId: "p1", profileName: "Local", keyspace: "app", table: "orders" };
    const keys = { id: "abc" };
    const values = { total: "20.0" };

    // Cassandra profile routes to cassandra.updateRow.
    const cassandra = {
      updateRow: vi.fn().mockResolvedValue({ updated: 1 })
    } as unknown as CassandraService;
    const cassandraStore = {
      get: vi.fn().mockResolvedValue(profile)
    } as unknown as ProfileStore;
    const cassandraCtx = buildContext({ cassandra, store: cassandraStore });

    const cassandraHandlers = createIpcHandlerMap(cassandraCtx);
    await expect(
      cassandraHandlers[ipcChannels.updateTableRow](table, keys, values)
    ).resolves.toEqual({ updated: 1 });
    expect(cassandra.updateRow).toHaveBeenCalledWith(table, keys, values);

    // Postgres profile routes to postgres.updateRow.
    const postgresProfile = {
      id: "p1",
      name: "Local",
      type: "postgres" as const,
      host: "127.0.0.1",
      port: 5432,
      database: "app",
      useTls: false
    };
    const postgres = {
      updateRow: vi.fn().mockResolvedValue({ updated: 1 })
    } as unknown as PostgresService;
    const postgresStore = {
      get: vi.fn().mockResolvedValue(postgresProfile)
    } as unknown as ProfileStore;
    const postgresCtx = buildContext({ postgres, store: postgresStore });

    const postgresHandlers = createIpcHandlerMap(postgresCtx);
    await expect(
      postgresHandlers[ipcChannels.updateTableRow](table, keys, values)
    ).resolves.toEqual({ updated: 1 });
    expect(postgres.updateRow).toHaveBeenCalledWith(table, keys, values);
  });
});
