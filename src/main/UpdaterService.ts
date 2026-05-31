import { app, type BrowserWindow } from "electron";
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
const GITHUB_LATEST_API =
  "https://api.github.com/repos/furkananter/mordor/releases/latest";

/**
 * Wraps update-check plumbing so the rest of the app stays unaware of platform
 * quirks:
 *
 *   - **Linux/Windows:** electron-updater drives the full lifecycle — check,
 *     download in the background, then "Restart to install" applies the
 *     update via Squirrel.
 *
 *   - **macOS:** the ad-hoc-signed (`identity: "-"`) build can't pass
 *     Squirrel.mac's signature check, so we don't run electron-updater here
 *     at all. Instead we hit the GitHub Releases API directly to learn
 *     whether a newer version exists, then surface a versioned banner with
 *     a manual-download CTA. Without a real Developer ID there is no other
 *     option; pretending an in-app install will work and then failing at
 *     restart-time would be worse than this honest fallback.
 *
 *   - **dev mode** (`!app.isPackaged`): no release to update against, the
 *     GitHub provider would 404. Status starts and stays `idle` so the
 *     renderer hides the banner entirely.
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
    if (process.platform === "darwin") {
      await this.checkForUpdatesMac();
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
   * macOS path: hit the GitHub Releases API ourselves and compare versions.
   * Doesn't try to invoke electron-updater because Squirrel.mac would reject
   * the ad-hoc-signed apply step. When a newer release exists we set
   * `kind: "available"` with `releasesUrl` so the renderer can render a
   * manual-download CTA. When the current build is already latest, set
   * `kind: "not-available"` so the banner hides itself.
   */
  private async checkForUpdatesMac(): Promise<void> {
    this.setStatus({ kind: "checking", lastCheckedAt: Date.now() });
    try {
      const res = await fetch(GITHUB_LATEST_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        throw new Error(`GitHub API responded ${res.status}`);
      }
      const data = (await res.json()) as { tag_name?: string };
      const latest = (data.tag_name ?? "").replace(/^v/, "").trim();
      const current = app.getVersion();
      if (!latest) {
        this.setStatus({ kind: "not-available", lastCheckedAt: Date.now() });
        return;
      }
      if (isNewerSemver(latest, current)) {
        this.setStatus({
          kind: "available",
          version: latest,
          releasesUrl: RELEASES_URL,
          lastCheckedAt: Date.now(),
        });
      } else {
        this.setStatus({
          kind: "not-available",
          version: latest,
          lastCheckedAt: Date.now(),
        });
      }
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

/**
 * Returns true when `candidate` is strictly newer than `current`. Handles the
 * basic semver triple (`major.minor.patch`); pre-release identifiers are
 * compared lexically as a tiebreaker. Stays inline because pulling the
 * `semver` package in for one comparison would balloon the main bundle.
 */
export function isNewerSemver(candidate: string, current: string): boolean {
  const parse = (v: string): [number, number, number, string] => {
    const [core, pre = ""] = v.split("-", 2);
    const [maj = "0", min = "0", patch = "0"] = (core ?? "").split(".");
    return [
      Number.parseInt(maj, 10) || 0,
      Number.parseInt(min, 10) || 0,
      Number.parseInt(patch, 10) || 0,
      pre,
    ];
  };
  const [aMaj, aMin, aPatch, aPre] = parse(candidate);
  const [bMaj, bMin, bPatch, bPre] = parse(current);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  if (aPatch !== bPatch) return aPatch > bPatch;
  // No pre-release on a build means the release is final; final > pre-release.
  if (aPre === "" && bPre !== "") return true;
  if (aPre !== "" && bPre === "") return false;
  return aPre > bPre;
}
