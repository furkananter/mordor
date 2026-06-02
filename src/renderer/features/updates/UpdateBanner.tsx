import { useState } from "react";
import { Download, RotateCw, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useUpdaterStore } from "../../store/updater";

/**
 * One-line banner at the top of the workspace. Only renders for states the
 * user can act on (available / downloading / downloaded); hidden in idle /
 * checking / not-available so the chrome doesn't jump every time a
 * background check runs.
 *
 * Updates download automatically on every platform, so available/downloading
 * just report progress with no button. The CTA appears at `downloaded` and
 * branches on `installerPath`:
 *
 *   - `installerPath` present (mac): "Open installer" — opens the downloaded
 *     DMG so the user can drag Mordor into /Applications. Squirrel can't apply
 *     the ad-hoc-signed build in place, so this is as close to one-click as
 *     macOS allows without a Developer ID.
 *
 *   - no `installerPath` (Linux/Windows): "Restart to install" hands off to
 *     electron-updater, which relaunches into the new version.
 */
export function UpdateBanner() {
  const status = useUpdaterStore((s) => s.status);
  const dismissedVersion = useUpdaterStore((s) => s.dismissedVersion);
  const dismiss = useUpdaterStore((s) => s.dismissBanner);
  const installNow = useUpdaterStore((s) => s.installNow);
  const [installing, setInstalling] = useState(false);

  const shouldShow =
    status.kind === "available" ||
    status.kind === "downloading" ||
    status.kind === "downloaded";
  if (!shouldShow) return null;
  // Dismissal is version-keyed (sentinel for un-versioned states). Hide if
  // the user already dismissed THIS exact version; the next release clears
  // the sentinel in the store.
  if (
    dismissedVersion &&
    (dismissedVersion === status.version || dismissedVersion === "__dismissed__")
  ) {
    return null;
  }
  // mac downloads a DMG the user opens manually; other platforms relaunch.
  const opensInstaller = Boolean(status.installerPath);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installNow();
      // On Linux/Windows a successful install quits the app before we get
      // here; on mac it just opens the DMG and returns. Either way, resetting
      // in `finally` lets the button be retried if it threw.
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div
      role="status"
      className="pointer-events-auto fixed right-4 top-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] items-center justify-between gap-3 rounded-ui border border-line-soft bg-panel px-4 py-2.5 text-[12px] text-text shadow-lg"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Download size={12} strokeWidth={1.7} className="shrink-0 text-accent" />
        <span className="truncate">{renderMessage(status)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {status.kind === "downloaded" ? (
          <Button variant="primary" onClick={() => void handleInstall()} disabled={installing}>
            {opensInstaller ? (
              <Download size={11} strokeWidth={1.7} />
            ) : (
              <RotateCw size={11} strokeWidth={1.7} />
            )}
            <span>{installLabel(opensInstaller, installing)}</span>
          </Button>
        ) : null}
        <Button onClick={dismiss} tooltip="Dismiss until next release">
          <X size={11} strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  );
}

function installLabel(opensInstaller: boolean, installing: boolean): string {
  if (opensInstaller) return installing ? "Opening…" : "Open installer";
  return installing ? "Restarting…" : "Restart to install";
}

function renderMessage(
  status: ReturnType<typeof useUpdaterStore.getState>["status"]
): string {
  const v = status.version ?? "";
  switch (status.kind) {
    case "available":
      return `Mordor ${v} is available — downloading…`;
    case "downloading":
      // Percent is the most legible signal; bytes/sec is noisy and varies
      // wildly across connections, so we keep the banner to one number.
      return `Downloading Mordor ${v}${status.progress ? ` · ${status.progress.percent}%` : ""}`;
    case "downloaded":
      return status.installerPath
        ? `Mordor ${v} downloaded — open the installer to finish.`
        : `Mordor ${v} is ready to install.`;
    default:
      return "";
  }
}
