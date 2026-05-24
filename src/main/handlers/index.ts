import { CassandraService } from "../../core/cassandra/CassandraService";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import { CassandraAdapter } from "../adapters/CassandraAdapter";
import { RedisAdapter } from "../adapters/RedisAdapter";
import { ProfileStore } from "../ProfileStore";
import { createMigrationHandlers } from "./migrationHandlers";
import { createProfileHandlers } from "./profileHandlers";
import { createRedisHandlers } from "./redisHandlers";
import { createSchemaHandlers } from "./schemaHandlers";

export interface MainContext {
  store: ProfileStore;
  cassandra: CassandraService;
  redis: RedisAdapter;
  adapters: AdapterRegistry;
}

export function createMainContext(store: ProfileStore): MainContext {
  const cassandra = new CassandraService();
  const redis = new RedisAdapter();
  const adapters = new AdapterRegistry();
  adapters.register(new CassandraAdapter(cassandra));
  adapters.register(redis);
  return { store, cassandra, redis, adapters };
}

export function createIpcHandlerMap(ctx: MainContext) {
  const { listProfiles, ...profileHandlers } = createProfileHandlers(
    ctx.store,
    ctx.adapters,
  );
  void listProfiles;
  return {
    ...profileHandlers,
    ...createSchemaHandlers(ctx.cassandra),
    ...createMigrationHandlers(ctx.cassandra),
    ...createRedisHandlers(ctx.redis),
  };
}
