import { ipcMain } from "electron";
import { ipcChannels } from "../core/ipc";
import { UpdaterService } from "./UpdaterService";

/**
 * Wire the renderer-facing updater IPC. Three request/response channels for
 * imperative actions (status snapshot, check, install) and one push channel
 * (`updater:status`) that the service broadcasts to attached windows whenever
 * the lifecycle state changes.
 *
 * Mounted once at app startup — calling twice would stack listeners and
 * double-fire every status broadcast.
 */
export function registerUpdaterIpc(updater: UpdaterService): void {
  ipcMain.handle(ipcChannels.getUpdateStatus, () => updater.getStatus());
  ipcMain.handle(ipcChannels.checkForUpdates, () => updater.checkForUpdates());
  ipcMain.handle(ipcChannels.installUpdate, () => updater.applyUpdate());
}
