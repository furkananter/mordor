import { CassandraService } from "../../core/cassandra/CassandraService";
import { PostgresService } from "../../core/postgres/PostgresService";
import { AdapterRegistry } from "../adapters/AdapterRegistry";
import { CassandraAdapter } from "../adapters/CassandraAdapter";
import { PostgresAdapter } from "../adapters/PostgresAdapter";
import { RedisAdapter } from "../adapters/RedisAdapter";
import { ProfileStore } from "../ProfileStore";
import { SshTunnel } from "../ssh/SshTunnel";
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
  // One shared tunnel manager across all engines — keyed by profileId so each
  // engine's connect/disconnect opens/closes the right bastion forward.
  const sshTunnel = new SshTunnel();
  const cassandra = new CassandraService(sshTunnel);
  const postgres = new PostgresService(sshTunnel);
  const redis = new RedisAdapter(sshTunnel);
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
