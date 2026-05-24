import { ipcChannels } from "../../core/ipc";
import { RedisAdapter } from "../adapters/RedisAdapter";

export function createRedisHandlers(redis: RedisAdapter) {
  return {
    [ipcChannels.redisDbStats]: (profileId: string) => redis.dbStats(profileId),
    [ipcChannels.redisScan]: (
      profileId: string,
      db: number,
      pattern: string,
      cursor: string,
    ) => redis.scan(profileId, db, pattern, cursor),
    [ipcChannels.redisGet]: (profileId: string, db: number, key: string) =>
      redis.getKey(profileId, db, key),
    [ipcChannels.redisDelete]: (profileId: string, db: number, key: string) =>
      redis.deleteKey(profileId, db, key),
    [ipcChannels.redisSetString]: (
      profileId: string,
      db: number,
      key: string,
      value: string,
      ttlSeconds?: number,
    ) => redis.setString(profileId, db, key, value, ttlSeconds),
    [ipcChannels.redisCommand]: (
      profileId: string,
      db: number,
      command: string,
    ) => redis.runCommand(profileId, db, command),
  };
}
