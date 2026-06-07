import { CassandraService } from "../../core/cassandra/CassandraService";
import { PostgresService } from "../../core/postgres/PostgresService";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import { CassandraAdapter } from "../adapters/CassandraAdapter";
import { PostgresAdapter } from "../adapters/PostgresAdapter";
import { RedisAdapter } from "../adapters/RedisAdapter";
import { ProfileStore } from "../ProfileStore";
import { createExportHandlers } from "./export-handlers";
import { createMigrationHandlers } from "./migrationHandlers";
import { createProfileHandlers } from "./profileHandlers";
import { createRedisHandlers } from "./redisHandlers";
import { createSchemaHandlers } from "./schemaHandlers";

export interface MainContext {
  store: ProfileStore;
  cassandra: CassandraService;
  postgres: PostgresService;
  redis: RedisAdapter;
  adapters: AdapterRegistry;
}

export function createMainContext(store: ProfileStore): MainContext {
  const cassandra = new CassandraService();
  const postgres = new PostgresService();
  const redis = new RedisAdapter();
  const adapters = new AdapterRegistry();
  adapters.register(new CassandraAdapter(cassandra));
  adapters.register(new PostgresAdapter(postgres));
  adapters.register(redis);
  return { store, cassandra, postgres, redis, adapters };
}

export function createIpcHandlerMap(ctx: MainContext) {
  const { listProfiles, ...profileHandlers } = createProfileHandlers(
    ctx.store,
    ctx.adapters,
  );
  void listProfiles;
  return {
    ...profileHandlers,
    ...createSchemaHandlers(ctx.store, ctx.cassandra, ctx.postgres),
    ...createMigrationHandlers(ctx.cassandra),
    ...createRedisHandlers(ctx.redis),
    ...createExportHandlers(ctx.store, ctx.cassandra, ctx.postgres, ctx.redis),
  };
}
