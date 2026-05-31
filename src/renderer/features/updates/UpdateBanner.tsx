import { useState } from "react";
import { Download, ExternalLink, RotateCw, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useUpdaterStore } from "../../store/updater";

/**
 * One-line banner at the top of the workspace. Only renders for states the
 * user can act on (available / downloading / downloaded / unsupported with
 * a fallback URL); hidden in idle / checking / not-available so the chrome
 * doesn't jump every time a background check runs.
 *
 * On `unsupported` (mac ad-hoc) we show a manual-download link instead of
 * an install button — the in-app updater literally can't apply the bits.
 */
export function UpdateBanner() {
  const status = useUpdaterStore((s) => s.status);
  const dismissedVersion = useUpdaterStore((s) => s.dismissedVersion);
  const dismiss = useUpdaterStore((s) => s.dismissBanner);
  const installNow = useUpdaterStore((s) => s.installNow);
  const [installing, setInstalling] = useState(false);

  // Hide entirely when there's nothing for the user to do, OR when the user
  // already dismissed this exact version.
  const shouldShow =
    status.kind === "available" ||
    status.kind === "downloading" ||
    status.kind === "downloaded" ||
    (status.kind === "unsupported" && Boolean(status.releasesUrl));
  if (!shouldShow) return null;
  if (status.version && dismissedVersion === status.version) return null;

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
        <span className="truncate">{renderMessage(status)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {status.kind === "downloaded" ? (
          <Button variant="primary" onClick={() => void handleInstall()} disabled={installing}>
            <RotateCw size={11} strokeWidth={1.7} />
            <span>{installing ? "Restarting…" : "Restart to install"}</span>
          </Button>
        ) : null}
        {status.kind === "unsupported" && status.releasesUrl ? (
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
        ) : null}
        <Button onClick={dismiss} tooltip="Dismiss until next release">
          <X size={11} strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  );
}

function renderMessage(status: ReturnType<typeof useUpdaterStore.getState>["status"]): string {
  const v = status.version ?? "";
  switch (status.kind) {
    case "available":
      return `Mordor ${v} is available — downloading…`;
    case "downloading":
      // Percent is the most legible signal; bytes/sec is noisy and varies
      // wildly across connections, so we keep the banner to one number.
      return `Downloading Mordor ${v}${status.progress ? ` · ${status.progress.percent}%` : ""}`;
    case "downloaded":
      return `Mordor ${v} is ready to install.`;
    case "unsupported":
      return `A newer Mordor may be available. In-app updates require a signed build — download manually for now.`;
    default:
      return "";
  }
}
