import { CassandraService } from "../../core/cassandra/CassandraService";
import { QueryMode } from "../../core/cassandra/query";
import { ipcChannels } from "../../core/ipc";
import { TableIdentity } from "../../core/shared/messages";

export function createSchemaHandlers(cassandra: CassandraService) {
  return {
    [ipcChannels.refreshSchema]: (profileId: string) =>
      cassandra.refreshSchema(profileId),
    [ipcChannels.getTableSchema]: (table: TableIdentity) =>
      cassandra.fetchTableSchema(table),
    [ipcChannels.getPreview]: (table: TableIdentity, pageState?: string) =>
      cassandra.fetchPreviewRows(table, pageState),
    [ipcChannels.runSelectQuery]: (
      profileId: string,
      cql: string,
      mode?: QueryMode,
    ) => cassandra.runSelectQuery(profileId, cql, mode),
    [ipcChannels.deleteTableRows]: (
      table: TableIdentity,
      rows: Array<Record<string, string>>,
    ) => cassandra.deleteRows(table, rows),
    [ipcChannels.getTableDdl]: (table: TableIdentity) =>
      cassandra.fetchTableDdl(table),
    [ipcChannels.runSchemaScript]: (profileId: string, cql: string) =>
      cassandra.runSchemaScript(profileId, cql),
  };
}
