import { WebContents } from "electron";
import * as os from "node:os";
import type { IPty } from "node-pty";

interface Session {
  id: string;
  pty: IPty;
  webContents: WebContents;
}

export class TerminalService {
  private sessions = new Map<string, Session>();
  private counter = 0;

  create(
    webContents: WebContents,
    options: { cwd?: string; cols?: number; rows?: number } = {},
  ): string {
    const ptyModule = require("node-pty") as Partial<
      typeof import("node-pty")
    > & { default?: typeof import("node-pty") };
    const pty = (
      typeof ptyModule.spawn === "function" ? ptyModule : ptyModule.default
    ) as typeof import("node-pty");
    if (!pty || typeof pty.spawn !== "function") {
      throw new Error(
        "node-pty failed to load — try `npm run postinstall` to rebuild native modules for Electron.",
      );
    }
    const shell =
      process.env.SHELL ??
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
    const cwd =
      options.cwd && options.cwd.length > 0 ? options.cwd : os.homedir();
    const session = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });

    this.counter += 1;
    const id = `term-${this.counter}`;
    const record: Session = { id, pty: session, webContents };
    this.sessions.set(id, record);

    session.onData((data) => {
      if (!webContents.isDestroyed())
        webContents.send("terminal:data", id, data);
    });
    session.onExit(({ exitCode, signal }) => {
      if (!webContents.isDestroyed())
        webContents.send("terminal:exit", id, { exitCode, signal });
      this.sessions.delete(id);
    });

    return id;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.pty.resize(
        Math.max(1, Math.floor(cols)),
        Math.max(1, Math.floor(rows)),
      );
    } catch {
      // PTY may already be closed; ignore.
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.pty.kill();
    } catch {
      // ignore
    }
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
