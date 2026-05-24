import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { FontScale, QueryMode, ThemePreference } from "../../store/constants";
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
