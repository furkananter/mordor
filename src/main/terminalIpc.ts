import { ipcMain } from "electron";
import { ipcChannels } from "../core/ipc";
import { TerminalService } from "./TerminalService";

export function registerTerminalIpc(terminals: TerminalService): void {
  ipcMain.handle(
    ipcChannels.terminalCreate,
    (event, options: { cwd?: string; cols?: number; rows?: number } = {}) => {
      return terminals.create(event.sender, options);
    },
  );
  ipcMain.on(ipcChannels.terminalWrite, (_event, id: string, data: string) => {
    terminals.write(id, data);
  });
  ipcMain.on(
    ipcChannels.terminalResize,
    (_event, id: string, cols: number, rows: number) => {
      terminals.resize(id, cols, rows);
    },
  );
  ipcMain.on(ipcChannels.terminalKill, (_event, id: string) => {
    terminals.kill(id);
  });
}
