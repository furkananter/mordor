import { app, shell, type BrowserWindow } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
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
 *   - **macOS (Developer-ID signed + notarized):** same as Linux/Windows.
 *     `__MAC_SIGNED__` is baked in at build time (see scripts/build-main.mjs);
 *     when true, Squirrel.mac can verify and apply the update, so we let
 *     electron-updater drive the seamless download + restart flow.
 *
 *   - **macOS (ad-hoc, `identity: "-"`):** the unsigned/ad-hoc build can't pass
 *     Squirrel.mac's signature check, so we don't run electron-updater here.
 *     Instead we hit the GitHub Releases API directly, and when a newer version
 *     exists we download the matching `.dmg` ourselves in the background (same
 *     `downloading`/`downloaded` states the other platforms report, with a
 *     SHA-256 integrity check). The install step opens the downloaded DMG for a
 *     drag-to-Applications install rather than relaunching in place. This is the
 *     fallback for builds made before the signing secrets were configured; the
 *     GitHub Releases link stays available as a manual escape hatch.
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
  // Guards the self-managed macOS download so a second check (e.g. the user
  // mashing "Check now" during the brief `available` window) can't kick off a
  // concurrent fetch that clobbers the same `.part` file.
  private macDownloadInFlight = false;

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
    // Only the ad-hoc macOS build needs the self-managed download. A signed +
    // notarized build (`__MAC_SIGNED__`) can be applied by Squirrel, so it
    // falls through to the electron-updater path like Linux/Windows.
    if (process.platform === "darwin" && !__MAC_SIGNED__) {
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
   * Doesn't invoke electron-updater because Squirrel.mac would reject the
   * ad-hoc-signed apply step. When a newer release exists we download the
   * matching `.dmg` ourselves (see `downloadMacUpdate`) so the update is on
   * disk and one click from installing; when the current build is already
   * latest we set `kind: "not-available"` so the banner hides itself.
   */
  private async checkForUpdatesMac(): Promise<void> {
    if (this.macDownloadInFlight) return;
    this.setStatus({ kind: "checking", lastCheckedAt: Date.now() });
    try {
      const res = await fetch(GITHUB_LATEST_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        throw new Error(`GitHub API responded ${res.status}`);
      }
      const data = (await res.json()) as {
        tag_name?: string;
        assets?: RawGithubAsset[];
      };
      const latest = (data.tag_name ?? "").replace(/^v/, "").trim();
      const current = app.getVersion();
      if (!latest) {
        this.setStatus({ kind: "not-available", lastCheckedAt: Date.now() });
        return;
      }
      if (!isNewerSemver(latest, current)) {
        this.setStatus({
          kind: "not-available",
          version: latest,
          lastCheckedAt: Date.now(),
        });
        return;
      }
      // Newer version exists. Mark it available immediately so the UI reacts,
      // then auto-download the architecture-matched DMG. If no suitable asset
      // is published (e.g. a release that only shipped zips) we leave the
      // status at `available` + `releasesUrl` so the manual link still works.
      const asset = pickMacAsset(data.assets ?? [], process.arch);
      this.setStatus({
        kind: "available",
        version: latest,
        releasesUrl: RELEASES_URL,
        lastCheckedAt: Date.now(),
      });
      if (asset) {
        await this.downloadMacUpdate(asset, latest);
      }
    } catch (caught) {
      this.setStatus({
        kind: "error",
        error: caught instanceof Error ? caught.message : String(caught),
        // Keep the manual-download escape hatch on failures too.
        releasesUrl: RELEASES_URL,
        lastCheckedAt: Date.now(),
      });
    }
  }

  /**
   * Stream the macOS DMG to a cache dir under `userData`, reporting progress
   * with the same `downloading` status shape the other platforms emit, then
   * verify its SHA-256 (when GitHub published a digest) before flipping to
   * `downloaded`. Writes to a `.part` file and renames on success so a partial
   * or corrupt download never gets the final, "trusted" name.
   */
  private async downloadMacUpdate(
    asset: MacReleaseAsset,
    version: string,
  ): Promise<void> {
    if (this.macDownloadInFlight) return;
    this.macDownloadInFlight = true;
    const updatesDir = join(app.getPath("userData"), "updates");
    const finalPath = join(updatesDir, asset.name);
    const partPath = `${finalPath}.part`;
    try {
      await mkdir(updatesDir, { recursive: true });

      // A previous check this launch (or a prior one) may already have a fully
      // verified copy — only fully-downloaded files ever get the final name,
      // so a size match is enough to trust it and skip re-fetching ~130 MB.
      if (await hasCompleteCopy(finalPath, asset.size)) {
        this.setStatus({
          kind: "downloaded",
          version,
          installerPath: finalPath,
          releasesUrl: RELEASES_URL,
          lastCheckedAt: Date.now(),
        });
        return;
      }

      // Drop stale installers (old versions, leftover `.part`) so the cache
      // doesn't grow by ~130 MB per release.
      await pruneUpdatesDir(updatesDir, asset.name);

      this.setStatus({
        kind: "downloading",
        version,
        releasesUrl: RELEASES_URL,
        progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: asset.size },
        lastCheckedAt: Date.now(),
      });

      const res = await fetch(asset.url, {
        headers: { Accept: "application/octet-stream" },
      });
      if (!res.ok || !res.body) {
        throw new Error(`Download failed: HTTP ${res.status}`);
      }
      const total =
        asset.size || Number(res.headers.get("content-length") ?? 0);

      const hash = createHash("sha256");
      const startedAt = Date.now();
      let transferred = 0;
      let lastEmit = 0;
      const reader = res.body.getReader();
      // Drive the byte stream through a generator into the file with
      // `pipeline`, which applies backpressure and — unlike a hand-rolled
      // write/drain loop — tears both ends down and rejects on any write error
      // (disk full, permissions) instead of hanging on a drain/close that
      // never fires. We hash and report progress as each chunk flows through.
      const emitProgress = (): void => {
        const now = Date.now();
        // Throttle to ~4/s; the byte loop fires far faster and flooding IPC
        // would just jank the renderer's progress bar.
        if (now - lastEmit < 250) return;
        lastEmit = now;
        const elapsed = Math.max(1, now - startedAt) / 1000;
        this.setStatus({
          kind: "downloading",
          version,
          releasesUrl: RELEASES_URL,
          progress: {
            percent: total ? Math.round((transferred / total) * 100) : 0,
            bytesPerSecond: Math.round(transferred / elapsed),
            transferred,
            total,
          },
          lastCheckedAt: Date.now(),
        });
      };
      await pipeline(
        async function* () {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            const chunk = Buffer.from(value);
            hash.update(chunk);
            transferred += chunk.length;
            emitProgress();
            yield chunk;
          }
        },
        createWriteStream(partPath),
      );

      // Verify integrity when GitHub supplied a digest; a mismatch means a
      // truncated or tampered download, so scrap it rather than offer a broken
      // installer.
      if (asset.sha256) {
        const digest = hash.digest("hex");
        if (digest !== asset.sha256) {
          await rm(partPath, { force: true });
          throw new Error("Downloaded update failed its integrity check.");
        }
      }

      await rename(partPath, finalPath);
      this.setStatus({
        kind: "downloaded",
        version,
        installerPath: finalPath,
        releasesUrl: RELEASES_URL,
        lastCheckedAt: Date.now(),
      });
    } catch (caught) {
      await rm(partPath, { force: true }).catch(() => undefined);
      this.setStatus({
        kind: "error",
        error: caught instanceof Error ? caught.message : String(caught),
        version,
        releasesUrl: RELEASES_URL,
        lastCheckedAt: Date.now(),
      });
    } finally {
      this.macDownloadInFlight = false;
    }
  }

  /**
   * Apply a previously-downloaded update.
   *
   *   - **macOS:** open the downloaded DMG so Finder mounts it and the user
   *     drags Mordor into /Applications. We deliberately don't quit — the
   *     ad-hoc build can't be swapped in place, the user may have unsaved
   *     work, and the DMG window guides the rest.
   *
   *   - **Linux/Windows:** hand off to Squirrel, which quits and relaunches
   *     into the new version. There's no recovery path if the user has unsaved
   *     work, so the UI should confirm before calling this.
   */
  async applyUpdate(): Promise<void> {
    if (this.status.kind !== "downloaded") {
      throw new Error("No update is downloaded — nothing to install.");
    }
    if (this.status.installerPath) {
      // shell.openPath resolves to "" on success or an error string otherwise.
      const failure = await shell.openPath(this.status.installerPath);
      if (failure) throw new Error(failure);
      return;
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

/** Shape of the bits we read out of a GitHub release `assets[]` entry. */
export interface RawGithubAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
  /** GitHub's content digest, e.g. `"sha256:<64 hex>"`; may be absent. */
  digest?: string | null;
}

/** The normalized macOS installer asset we hand to `downloadMacUpdate`. */
export interface MacReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** Lower-case hex SHA-256, or undefined when GitHub didn't publish one. */
  sha256?: string;
}

/**
 * Choose the DMG matching the running architecture. electron-builder names the
 * Apple-Silicon image `…-arm64.dmg` and the Intel one `….dmg` (no arch
 * suffix). An arm64 host can run the Intel build under Rosetta, so it falls
 * back to the Intel DMG when no arm64 one is published; an Intel host cannot
 * run an arm64 build, so it never falls back. Returns undefined when nothing
 * suitable exists, letting the caller keep the manual-download link instead.
 */
export function pickMacAsset(
  assets: RawGithubAsset[],
  arch: string,
): MacReleaseAsset | undefined {
  const dmgs = assets.filter(
    (a): a is RawGithubAsset & { name: string; browser_download_url: string } =>
      typeof a.name === "string" &&
      a.name.endsWith(".dmg") &&
      typeof a.browser_download_url === "string",
  );
  if (dmgs.length === 0) return undefined;
  const isArm = (name: string) => /arm64/i.test(name);
  const arm = dmgs.find((a) => isArm(a.name));
  const intel = dmgs.find((a) => !isArm(a.name));
  const match = arch === "arm64" ? (arm ?? intel) : intel;
  if (!match) return undefined;
  const normalized: MacReleaseAsset = {
    name: match.name,
    url: match.browser_download_url,
    size: match.size ?? 0,
  };
  const sha256 = parseSha256(match.digest);
  if (sha256) normalized.sha256 = sha256;
  return normalized;
}

/** Pull the hex out of a `"sha256:<hex>"` digest; undefined if not present. */
export function parseSha256(digest: string | null | undefined): string | undefined {
  if (!digest) return undefined;
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim());
  return match ? match[1]!.toLowerCase() : undefined;
}

/**
 * True when `path` already holds a complete download. We only ever rename a
 * file to its final name after a successful (and, when possible, verified)
 * download, so a matching byte size is sufficient evidence — no need to re-hash
 * ~130 MB on every launch.
 */
async function hasCompleteCopy(path: string, expectedSize: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && (!expectedSize || info.size === expectedSize);
  } catch {
    return false;
  }
}

/** Best-effort removal of everything in the updates dir except `keepName`. */
async function pruneUpdatesDir(dir: string, keepName: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .filter((name) => name !== keepName)
        .map((name) => rm(join(dir, name), { force: true })),
    );
  } catch {
    // The dir may not exist yet, or a file may be locked — neither is fatal to
    // the download we're about to start.
  }
}
