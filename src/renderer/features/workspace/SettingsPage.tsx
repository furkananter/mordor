import { useState } from "react";
import { Download, ExternalLink, RotateCw, ShieldAlert } from "lucide-react";
import { UpdateStatus } from "../../../core/ipc";
import { Button } from "../../components/ui/Button";
import { FontScale, QueryMode, ThemePreference } from "../../store/constants";
import { useUpdaterStore } from "../../store/updater";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../../components/ui/AlertDialog";

const QUERY_MODE_LABELS: Record<QueryMode, { label: string; description: string }> = {
  read: { label: "Read", description: "SELECT only — safest." },
  write: { label: "Write", description: "SELECT + INSERT/UPDATE/DELETE. DDL still blocked." },
  all: { label: "All", description: "Anything goes, including CREATE/ALTER/DROP. Be careful." }
};

export function SettingsPage({
  connectionCount,
  onlineCount,
  themePreference,
  onThemeChange,
  fontScale,
  onFontScaleChange,
  queryMode,
  onQueryModeChange
}: {
  connectionCount: number;
  onlineCount: number;
  themePreference: ThemePreference;
  onThemeChange(themePreference: ThemePreference): void;
  fontScale: FontScale;
  onFontScaleChange(fontScale: FontScale): void;
  queryMode: QueryMode;
  onQueryModeChange(mode: QueryMode): void;
}) {
  const [pendingMode, setPendingMode] = useState<QueryMode | undefined>(undefined);

  const handleQueryModeClick = (next: QueryMode) => {
    if (next === queryMode) return;
    if (next === "read") {
      onQueryModeChange(next);
      return;
    }
    setPendingMode(next);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel">
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <h2 className="text-[20px] font-semibold tracking-tight text-text">Settings</h2>
        <p className="mt-1 text-[13px] text-muted">Configure the Mordor workspace.</p>

        <div className="mt-8 grid gap-6">
          <Row label="Connections" value={`${connectionCount}`} meta={`${onlineCount} online`} />

          <Section title="Query mode" description="Controls which CQL statements the editor will execute.">
            <SegmentedControl<QueryMode>
              value={queryMode}
              options={["read", "write", "all"]}
              labelFor={(mode) => QUERY_MODE_LABELS[mode].label}
              onChange={handleQueryModeClick}
              dangerOptions={["write", "all"]}
            />
            <p className="mt-2 text-[11.5px] text-muted">{QUERY_MODE_LABELS[queryMode].description}</p>
          </Section>

          <Section title="Theme" description="Choose a fixed theme or follow the system.">
            <SegmentedControl<ThemePreference>
              value={themePreference}
              options={["light", "dark", "auto"]}
              labelFor={(option) => option}
              onChange={onThemeChange}
            />
          </Section>

          <Section title="Font size" description="Scale the entire interface.">
            <SegmentedControl<FontScale>
              value={fontScale}
              options={["small", "normal", "large"]}
              labelFor={(option) => option}
              onChange={onFontScaleChange}
            />
          </Section>

          <Section
            title="Updates"
            description="Mordor checks for new releases on launch. You can also check manually here."
          >
            <UpdatesPanel />
          </Section>
        </div>

        <footer className="mt-10 flex items-center justify-between border-t border-line-soft pt-4 text-[11.5px] text-muted">
          <span>Version</span>
          <span className="font-mono text-text">{__APP_VERSION__}</span>
        </footer>
      </div>

      <AlertDialog open={pendingMode !== undefined} onOpenChange={(open) => { if (!open) setPendingMode(undefined); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <span className="inline-flex items-center gap-2">
                <ShieldAlert size={15} strokeWidth={1.7} className="text-warning" />
                Enable {pendingMode ? QUERY_MODE_LABELS[pendingMode].label : ""} mode?
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMode ? QUERY_MODE_LABELS[pendingMode].description : null} Queries you run from the CQL console will be executed against the live cluster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => {
                if (pendingMode) onQueryModeChange(pendingMode);
                setPendingMode(undefined);
              }}
            >
              Enable {pendingMode ? QUERY_MODE_LABELS[pendingMode].label : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SegmentedControl<T extends string>({
  value,
  options,
  labelFor,
  onChange,
  dangerOptions = []
}: {
  value: T;
  options: readonly T[];
  labelFor(option: T): string;
  onChange(option: T): void;
  dangerOptions?: readonly T[];
}) {
  return (
    <div className="inline-flex items-center gap-0 rounded-ui border border-line p-0.5">
      {options.map((option) => {
        const selected = value === option;
        const dangerous = dangerOptions.includes(option);
        const selectedClass = selected
          ? dangerous
            ? "bg-warning/15 text-warning"
            : "bg-line-soft text-text"
          : "text-muted hover:text-text";
        return (
          <button
            key={option}
            type="button"
            className={`rounded-[4px] px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${selectedClass}`}
            onClick={() => onChange(option)}
          >
            {labelFor(option)}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line-soft pb-3">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="text-[13px] text-text">
        {value} <span className="text-muted">· {meta}</span>
      </span>
    </div>
  );
}

function Section({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-line-soft pb-5 last:border-b-0">
      <h3 className="text-[13px] font-medium text-text">{title}</h3>
      <p className="text-[12px] leading-[1.5] text-muted">{description}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function UpdatesPanel() {
  const status = useUpdaterStore((s) => s.status);
  const checkNow = useUpdaterStore((s) => s.checkNow);
  const installNow = useUpdaterStore((s) => s.installNow);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  // `available` is a brief, auto-downloading state on every platform now — keep
  // the check button disabled through it so a second check can't race the
  // download that's already starting.
  const isBusy =
    checking ||
    status.kind === "checking" ||
    status.kind === "available" ||
    status.kind === "downloading";
  const isDownloaded = status.kind === "downloaded";
  // mac downloads a DMG to open manually; other platforms relaunch via Squirrel.
  const opensInstaller = Boolean(status.installerPath);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await checkNow();
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installNow();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 rounded-ui border border-line-soft bg-panel-soft px-3 py-2">
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[12.5px] text-text">{statusLine(status)}</span>
          <span className="text-[11px] text-muted">{detailLine(status)}</span>
        </div>
        {isDownloaded ? (
          <Button
            variant="primary"
            onClick={() => void handleInstall()}
            disabled={installing}
            tooltip={opensInstaller ? "Open the downloaded installer" : "Restart and install the update"}
          >
            {opensInstaller ? (
              <Download size={11} strokeWidth={1.7} />
            ) : (
              <RotateCw size={11} strokeWidth={1.7} />
            )}
            <span>{installLabel(opensInstaller, installing)}</span>
          </Button>
        ) : (
          <Button onClick={() => void handleCheck()} disabled={isBusy} tooltip="Check for updates now">
            <RotateCw size={11} strokeWidth={1.7} className={isBusy ? "animate-spin" : undefined} />
            <span>{isBusy ? checkLabel(status) : "Check now"}</span>
          </Button>
        )}
      </div>
      {status.kind === "error" && status.error ? (
        <p className="px-1 text-[11px] text-danger">{status.error}</p>
      ) : null}
      {status.releasesUrl ? (
        <p className="px-1 text-[11px] leading-[1.5] text-muted">
          This build isn't signed with a Developer ID, so Mordor downloads the
          update and opens the installer for you — drag Mordor into Applications
          to finish.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-text"
            onClick={() => window.open(status.releasesUrl, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={10} strokeWidth={1.7} className="mr-0.5 inline align-[-1px]" />
            Releases page
          </button>
        </p>
      ) : null}
    </div>
  );
}

function installLabel(opensInstaller: boolean, installing: boolean): string {
  if (opensInstaller) return installing ? "Opening…" : "Open installer";
  return installing ? "Restarting…" : "Restart to install";
}

function checkLabel(status: UpdateStatus): string {
  return status.kind === "downloading" ? "Downloading…" : "Checking…";
}

function statusLine(status: UpdateStatus): string {
  switch (status.kind) {
    case "idle":
      return "Not checked yet";
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Mordor ${status.version ?? ""} available — downloading…`;
    case "downloading":
      return `Downloading${status.progress ? ` · ${status.progress.percent}%` : "…"}`;
    case "downloaded":
      return status.installerPath
        ? `Mordor ${status.version ?? ""} downloaded — open the installer to finish`
        : `Mordor ${status.version ?? ""} downloaded — restart to install`;
    case "not-available":
      return "Mordor is up to date";
    case "error":
      return "Update check failed";
    case "unsupported":
      // Reserved — no platform currently reports this.
      return "In-app updates are not available on this build";
  }
}

function detailLine(status: UpdateStatus): string {
  if (!status.lastCheckedAt) return "Mordor will check automatically a few seconds after launch.";
  return `Last checked: ${formatRelative(status.lastCheckedAt)}`;
}

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
