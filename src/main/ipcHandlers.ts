import { ipcMain } from "electron";
import { MainContext, createIpcHandlerMap } from "./handlers";

type IpcHandler = (...args: never[]) => Promise<unknown>;

export function registerIpcHandlers(ctx: MainContext): void {
  const handlers = createIpcHandlerMap(ctx);
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args) =>
      (handler as IpcHandler)(...(args as never[])),
    );
  }
}
