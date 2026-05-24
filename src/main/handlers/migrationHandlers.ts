import { BrowserWindow, dialog } from "electron";
import { CassandraService } from "../../core/cassandra/CassandraService";
import { MigrationService } from "../../core/cassandra/migrations/MigrationService";
import { ipcChannels } from "../../core/ipc";

export function createMigrationHandlers(cassandra: CassandraService) {
  const migrations = new MigrationService(cassandra);

  return {
    [ipcChannels.pickMigrationsFolder]: async () => {
      const focused = BrowserWindow.getFocusedWindow();
      const result = focused
        ? await dialog.showOpenDialog(focused, {
            title: "Select migrations folder",
            properties: ["openDirectory"],
          })
        : await dialog.showOpenDialog({
            title: "Select migrations folder",
            properties: ["openDirectory"],
          });
      if (result.canceled || result.filePaths.length === 0) return undefined;
      return result.filePaths[0];
    },
    [ipcChannels.listMigrations]: (
      profileId: string,
      keyspace: string,
      folder: string,
    ) => migrations.list(profileId, keyspace, folder),
    [ipcChannels.previewMigration]: (folder: string, version: string) =>
      migrations.preview(folder, version),
    [ipcChannels.createMigration]: (folder: string, name: string) =>
      migrations.create(folder, name),
    [ipcChannels.readMigrationFile]: (folder: string, filename: string) =>
      migrations.readFile(folder, filename),
    [ipcChannels.writeMigrationFile]: (
      folder: string,
      filename: string,
      contents: string,
    ) => migrations.writeFile(folder, filename, contents),
    [ipcChannels.applyMigration]: (
      profileId: string,
      keyspace: string,
      folder: string,
      version: string,
    ) => migrations.applyOne(profileId, keyspace, folder, version),
    [ipcChannels.ensureMigrationTable]: (profileId: string, keyspace: string) =>
      migrations.ensureTrackingTable(profileId, keyspace),
  };
}
