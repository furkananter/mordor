import { useState } from "react";
import { Download, ExternalLink, RotateCw, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useUpdaterStore } from "../../store/updater";

/**
 * One-line banner at the top of the workspace. Only renders for states the
 * user can act on (available / downloading / downloaded); hidden in idle /
 * checking / not-available so the chrome doesn't jump every time a
 * background check runs.
 *
 * The CTA branches on whether the status carries a `releasesUrl`:
 *
 *   - `releasesUrl` present (mac path): manual-download external link
 *     because Squirrel.mac can't apply ad-hoc-signed updates.
 *
 *   - no `releasesUrl` + kind=downloaded (Linux/Windows): "Restart to
 *     install" via electron-updater.
 *
 *   - no `releasesUrl` + kind=available/downloading: just show progress
 *     because the updater is already pulling the bits.
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
  const manualDownload = Boolean(status.releasesUrl);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installNow();
      // If install succeeds the app quits before we get here. We only land
      // back here on a thrown error; reset so the button can be retried.
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
        <span className="truncate">{renderMessage(status, manualDownload)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {manualDownload && status.releasesUrl ? (
          <Button
            variant="primary"
            onClick={() => {
              // External link — opens in the user's browser via Electron's
              // default protocol handler (no nodeIntegration, no shell exposure).
              window.open(status.releasesUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink size={11} strokeWidth={1.7} />
            <span>Download</span>
          </Button>
        ) : status.kind === "downloaded" ? (
          <Button variant="primary" onClick={() => void handleInstall()} disabled={installing}>
            <RotateCw size={11} strokeWidth={1.7} />
            <span>{installing ? "Restarting…" : "Restart to install"}</span>
          </Button>
        ) : null}
        <Button onClick={dismiss} tooltip="Dismiss until next release">
          <X size={11} strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  );
}

function renderMessage(
  status: ReturnType<typeof useUpdaterStore.getState>["status"],
  manualDownload: boolean
): string {
  const v = status.version ?? "";
  switch (status.kind) {
    case "available":
      // On mac (manualDownload) we won't auto-pull the bits, so the message
      // should say "available" without implying a background download.
      return manualDownload
        ? `Mordor ${v} is available — download from GitHub Releases.`
        : `Mordor ${v} is available — downloading…`;
    case "downloading":
      // Percent is the most legible signal; bytes/sec is noisy and varies
      // wildly across connections, so we keep the banner to one number.
      return `Downloading Mordor ${v}${status.progress ? ` · ${status.progress.percent}%` : ""}`;
    case "downloaded":
      return `Mordor ${v} is ready to install.`;
    default:
      return "";
  }
}
