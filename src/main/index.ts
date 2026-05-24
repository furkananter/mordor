import { app, BrowserWindow, Menu, nativeImage } from "electron";
import { join } from "node:path";

// Ubuntu 24.04+ / Debian Trixie enforce an AppArmor profile that blocks
// unprivileged user namespaces, so Electron's setuid chrome-sandbox fails and the
// AppImage refuses to launch without `--no-sandbox`. Disabling the sandbox here
// lets users double-click the AppImage. The renderer is already isolated by
// contextIsolation + no nodeIntegration, so this is the standard trade-off taken
// by every Electron DB tool that ships an AppImage (DBeaver, Beekeeper, etc.).
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
}
import { ProfileStore } from "./ProfileStore";
import { SecretStore } from "./SecretStore";
import { TerminalService } from "./TerminalService";
import { createMainContext } from "./handlers";
import { registerIpcHandlers } from "./ipcHandlers";
import { registerTerminalIpc } from "./terminalIpc";

const terminals = new TerminalService();
let mainContext: ReturnType<typeof createMainContext> | undefined;

function resolveIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(__dirname, "../../media/macos/AppIcon512.png"),
    join(process.resourcesPath ?? "", "media/macos/AppIcon512.png"),
  ];
  for (const candidate of candidates) {
    const image = nativeImage.createFromPath(candidate);
    if (!image.isEmpty()) return image;
  }
  return undefined;
}

async function createWindow(): Promise<void> {
  const icon = resolveIcon();
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    title: "Mordor",
    ...(icon ? { icon } : {}),
    backgroundColor: "#faf8f3",
    titleBarOverlay: {
      color: "#faf8f3",
      height: 42,
      symbolColor: "#2a2724",
    },
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const broadcastFullscreen = () => {
    window.webContents.send("window:fullscreen", window.isFullScreen());
  };
  window.on("enter-full-screen", broadcastFullscreen);
  window.on("leave-full-screen", broadcastFullscreen);
  window.webContents.on("did-finish-load", broadcastFullscreen);

  const isDev = process.defaultApp;
  const rendererUrl =
    process.env.RENDERER_URL ?? (isDev ? "http://localhost:5273" : undefined);
  if (rendererUrl) {
    try {
      await window.loadURL(rendererUrl);
      return;
    } catch {
      // Fallback to packaged bundle if Vite server is not reachable.
    }
  }

  await window.loadFile(join(__dirname, "../renderer/index.html"));
}

/**
 * In packaged builds, drop the View menu's Reload + Force Reload entries (and
 * their `Cmd+R` / `Cmd+Shift+R` shortcuts). A renderer reload here costs the
 * user a 5-10 s cold start with no upside — there's no live remote content,
 * no useful "back to a fresh state" semantics, and accidental Cmd+R was a
 * recurring frustration. Dev builds keep the defaults so we can iterate.
 */
function installProductionMenu(): void {
  if (!app.isPackaged) return;
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  installProductionMenu();
  const store = new ProfileStore(
    join(app.getPath("userData"), "profiles.json"),
    new SecretStore(),
  );
  mainContext = createMainContext(store);
  registerIpcHandlers(mainContext);
  registerTerminalIpc(terminals);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  terminals.disposeAll();
  void mainContext?.adapters.disposeAll();
});
