import { contextBridge, ipcRenderer, webFrame } from "electron";
import { CassandraDeskApi, ipcChannels } from "../core/ipc";

const api: CassandraDeskApi = {
  listProfiles: () => ipcRenderer.invoke(ipcChannels.listProfiles),
  createProfile: (input) =>
    ipcRenderer.invoke(ipcChannels.createProfile, input),
  updateProfile: (profileId, input) =>
    ipcRenderer.invoke(ipcChannels.updateProfile, profileId, input),
  deleteProfile: (profileId) =>
    ipcRenderer.invoke(ipcChannels.deleteProfile, profileId),
  detectLocalConnections: () =>
    ipcRenderer.invoke(ipcChannels.detectLocalConnections),
  connect: (profileId) => ipcRenderer.invoke(ipcChannels.connect, profileId),
  disconnect: (profileId) =>
    ipcRenderer.invoke(ipcChannels.disconnect, profileId),
  refreshSchema: (profileId) =>
    ipcRenderer.invoke(ipcChannels.refreshSchema, profileId),
  getTableSchema: (table) =>
    ipcRenderer.invoke(ipcChannels.getTableSchema, table),
  getPreview: (table, pageState) =>
    ipcRenderer.invoke(ipcChannels.getPreview, table, pageState),
  runSelectQuery: (profileId, cql, mode) =>
    ipcRenderer.invoke(ipcChannels.runSelectQuery, profileId, cql, mode),
  deleteTableRows: (table, rows) =>
    ipcRenderer.invoke(ipcChannels.deleteTableRows, table, rows),
  getTableDdl: (table) => ipcRenderer.invoke(ipcChannels.getTableDdl, table),
  runSchemaScript: (profileId, cql) =>
    ipcRenderer.invoke(ipcChannels.runSchemaScript, profileId, cql),
  pickMigrationsFolder: () =>
    ipcRenderer.invoke(ipcChannels.pickMigrationsFolder),
  listMigrations: (profileId, keyspace, folder) =>
    ipcRenderer.invoke(ipcChannels.listMigrations, profileId, keyspace, folder),
  previewMigration: (folder, version) =>
    ipcRenderer.invoke(ipcChannels.previewMigration, folder, version),
  createMigration: (folder, name) =>
    ipcRenderer.invoke(ipcChannels.createMigration, folder, name),
  readMigrationFile: (folder, filename) =>
    ipcRenderer.invoke(ipcChannels.readMigrationFile, folder, filename),
  writeMigrationFile: (folder, filename, contents) =>
    ipcRenderer.invoke(
      ipcChannels.writeMigrationFile,
      folder,
      filename,
      contents,
    ),
  applyMigration: (profileId, keyspace, folder, version) =>
    ipcRenderer.invoke(
      ipcChannels.applyMigration,
      profileId,
      keyspace,
      folder,
      version,
    ),
  ensureMigrationTable: (profileId, keyspace) =>
    ipcRenderer.invoke(ipcChannels.ensureMigrationTable, profileId, keyspace),
  redisDbStats: (profileId) =>
    ipcRenderer.invoke(ipcChannels.redisDbStats, profileId),
  redisScan: (profileId, db, pattern, cursor) =>
    ipcRenderer.invoke(ipcChannels.redisScan, profileId, db, pattern, cursor),
  redisGet: (profileId, db, key) =>
    ipcRenderer.invoke(ipcChannels.redisGet, profileId, db, key),
  redisDelete: (profileId, db, key) =>
    ipcRenderer.invoke(ipcChannels.redisDelete, profileId, db, key),
  redisSetString: (profileId, db, key, value, ttlSeconds) =>
    ipcRenderer.invoke(
      ipcChannels.redisSetString,
      profileId,
      db,
      key,
      value,
      ttlSeconds,
    ),
  redisCommand: (profileId, db, command) =>
    ipcRenderer.invoke(ipcChannels.redisCommand, profileId, db, command),
  setZoomFactor: (factor) => {
    webFrame.setZoomFactor(factor);
  },
  onFullscreenChange: (callback) => {
    const listener = (_event: unknown, fullscreen: boolean) =>
      callback(fullscreen);
    ipcRenderer.on("window:fullscreen", listener);
    return () => {
      ipcRenderer.off("window:fullscreen", listener);
    };
  },
  terminalCreate: (options) =>
    ipcRenderer.invoke(ipcChannels.terminalCreate, options),
  terminalWrite: (id, data) =>
    ipcRenderer.send(ipcChannels.terminalWrite, id, data),
  terminalResize: (id, cols, rows) =>
    ipcRenderer.send(ipcChannels.terminalResize, id, cols, rows),
  terminalKill: (id) => ipcRenderer.send(ipcChannels.terminalKill, id),
  onTerminalData: (callback) => {
    const listener = (_event: unknown, id: string, data: string) =>
      callback(id, data);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.off("terminal:data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (
      _event: unknown,
      id: string,
      info: { exitCode: number; signal?: number },
    ) => callback(id, info);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.off("terminal:exit", listener);
  },
  getUpdateStatus: () => ipcRenderer.invoke(ipcChannels.getUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(ipcChannels.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(ipcChannels.installUpdate),
  onUpdateStatus: (callback) => {
    // Main pushes `updater:status` on every lifecycle transition AND once per
    // attachWindow() so a freshly-mounted UI gets the current state without
    // a separate fetch. The renderer-side hook still calls getUpdateStatus
    // for the very first synchronous render before the listener attaches.
    const listener = (_event: unknown, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on("updater:status", listener);
    return () => {
      ipcRenderer.off("updater:status", listener);
    };
  },
};

contextBridge.exposeInMainWorld("cassandraDesk", api);
