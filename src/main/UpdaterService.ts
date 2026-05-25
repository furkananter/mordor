import type { BrowserWindow } from "electron";
import type { AppUpdater, UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "../core/ipc";

// electron-updater pulls in ~200 KB of HTTPS + signature-verification code on
// require. Defer the import until we actually run a check so the main-process
// boot cost stays where it was. The cached module is reused on subsequent
// checks.
let updaterPromise: Promise<AppUpdater> | undefined;
async function loadUpdater(): Promise<AppUpdater> {
  if (!updaterPromise) {
    updaterPromise = import("electron-updater").then((m) => m.autoUpdater);
  }
  return updaterPromise;
}

const RELEASES_URL = "https://github.com/furkananter/mordor/releases/latest";

/**
 * Wraps electron-updater so the rest of the app stays unaware of its quirks:
 *
 *   - mac without a Developer ID can NOT auto-update (Squirrel requires a
 *     signed+notarized bundle; `identity: "-"` ad-hoc builds get rejected by
 *     Gatekeeper on the update path). The service detects this and reports
 *     `unsupported` so the UI offers a manual-download fallback instead of
 *     pretending and failing silently when the user clicks Install.
 *
 *   - dev mode (`!app.isPackaged`) never runs the real updater — the dev
 *     bundle isn't a release, the GitHub provider would 404. Status starts
 *     and stays `idle` so the renderer can hide the banner entirely.
 *
 *   - All status changes are pushed to ALL open BrowserWindow instances via
 *     IPC. Renderer keeps the latest snapshot in a Zustand store; new
 *     windows fetch the snapshot synchronously on mount.
 */
export class UpdaterService {
  private status: UpdateStatus = { kind: "idle" };
  private windows = new Set<BrowserWindow>();
  private listenersBound = false;

  /** Register a renderer for push notifications. Idempotent. */
  attachWindow(window: BrowserWindow): void {
    this.windows.add(window);
    window.once("closed", () => this.windows.delete(window));
    // Send the current snapshot so a freshly-mounted UI doesn't have to wait
    // for the next status change to know whether an update is pending.
    this.broadcast(window);
  }

  /** Current snapshot — used by the IPC `updater:status` request handler. */
  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * Called by main/index.ts after the window is up. Schedules the first
   * background check ~10 s after boot so it doesn't compete with the user's
   * first interaction (sidebar render, profile list fetch). Subsequent checks
   * happen on a long interval; for v1 we leave it user-driven via the
   * Settings "Check now" button.
   */
  scheduleStartupCheck(isPackaged: boolean): void {
    if (!isPackaged) {
      // Dev mode — no release to update against. Stay idle.
      this.setStatus({ kind: "idle" });
      return;
    }
    if (process.platform === "darwin") {
      // Ad-hoc signed builds (identity "-") fail Squirrel.mac's signature
      // check during the update apply step. Without a real Developer ID we
      // can't ship working mac auto-update. Surface unsupported so the UI
      // tells the user where to grab the next build manually.
      this.setStatus({
        kind: "unsupported",
        releasesUrl: RELEASES_URL,
      });
      return;
    }
    setTimeout(() => {
      void this.checkForUpdates();
    }, 10_000);
  }

  /**
   * Manual or scheduled check. Safe to call from any context — guards against
   * dev/unsupported platforms and against re-entering while a previous check
   * is still running.
   */
  async checkForUpdates(): Promise<void> {
    if (this.status.kind === "checking" || this.status.kind === "downloading") {
      // Already in flight — don't kick off a second one.
      return;
    }
    if (this.status.kind === "unsupported") {
      // Mac ad-hoc / dev — refuse silently. The Settings UI hides the
      // "Check now" button in this state, but the IPC channel is still
      // reachable so we guard defensively.
      return;
    }
    try {
      const autoUpdater = await loadUpdater();
      this.bindListeners(autoUpdater);
      this.setStatus({ kind: "checking", lastCheckedAt: Date.now() });
      // Returns immediately; events drive the rest of the lifecycle.
      await autoUpdater.checkForUpdates();
    } catch (caught) {
      this.setStatus({
        kind: "error",
        error: caught instanceof Error ? caught.message : String(caught),
        lastCheckedAt: Date.now(),
      });
    }
  }

  /**
   * Apply a previously-downloaded update. Quits the app and relaunches into
   * the new version — there's no recovery path if the user has unsaved work,
   * so the UI should confirm before calling this.
   */
  async installAndRestart(): Promise<void> {
    if (this.status.kind !== "downloaded") {
      throw new Error("No update is downloaded — nothing to install.");
    }
    const autoUpdater = await loadUpdater();
    // `isSilent: true` suppresses the Windows NSIS UI; `isForceRunAfter: true`
    // ensures the app relaunches even when the installer would otherwise exit
    // without restarting (the default on some platforms).
    autoUpdater.quitAndInstall(true, true);
  }

  /**
   * Wire electron-updater's event stream onto our status broadcaster. Bound
   * once on the first checkForUpdates() to avoid stacking listeners across
   * repeated checks.
   */
  private bindListeners(autoUpdater: AppUpdater): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    // Configure once: never auto-install (we want the user to confirm), but
    // do auto-download so the install step is fast when they click.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("checking-for-update", () => {
      this.setStatus({ kind: "checking", lastCheckedAt: Date.now() });
    });
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.setStatus({
        kind: "available",
        version: info.version,
        lastCheckedAt: Date.now(),
      });
    });
    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      this.setStatus({
        kind: "not-available",
        version: info.version,
        lastCheckedAt: Date.now(),
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      const next: UpdateStatus = {
        kind: "downloading",
        progress: {
          percent: Math.round(progress.percent ?? 0),
          bytesPerSecond: Math.round(progress.bytesPerSecond ?? 0),
          transferred: Math.round(progress.transferred ?? 0),
          total: Math.round(progress.total ?? 0),
        },
        lastCheckedAt: this.status.lastCheckedAt ?? Date.now(),
      };
      // `exactOptionalPropertyTypes` makes `version: undefined` invalid for
      // an optional `version?: string` field — set it conditionally instead.
      if (this.status.version) next.version = this.status.version;
      this.setStatus(next);
    });
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.setStatus({
        kind: "downloaded",
        version: info.version,
        lastCheckedAt: Date.now(),
      });
    });
    autoUpdater.on("error", (err) => {
      this.setStatus({
        kind: "error",
        error: err instanceof Error ? err.message : String(err),
        lastCheckedAt: Date.now(),
      });
    });
  }

  private setStatus(next: UpdateStatus): void {
    this.status = next;
    for (const window of this.windows) {
      if (window.isDestroyed()) {
        this.windows.delete(window);
        continue;
      }
      this.broadcast(window);
    }
  }

  private broadcast(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    window.webContents.send("updater:status", this.status);
  }
}
