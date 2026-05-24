import { useState } from "react";
import { FolderOpen, Settings2 } from "lucide-react";
import { CassandraProfileListItem } from "../../../../core/ipc";
import { Button } from "../../../components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/Select";

const inputClass =
  "w-full rounded-ui border border-line bg-panel px-2.5 py-1.5 text-[13px] text-text placeholder:text-subtle focus-visible:border-accent focus-visible:outline-none";

export function ConfigEditor({
  profile,
  onCancel,
  onSave
}: {
  profile: CassandraProfileListItem;
  onCancel?: (() => void) | undefined;
  onSave(folder: string, keyspace: string): Promise<void>;
}) {
  const [folder, setFolder] = useState(profile.migrationsFolder ?? "");
  const [keyspace, setKeyspace] = useState(profile.migrationsKeyspace ?? "");
  const [saving, setSaving] = useState(false);
  const keyspaceOptions = profile.connected ? profile.schema.map((entry) => entry.name) : [];

  const pickFolder = async () => {
    const picked = await window.cassandraDesk.pickMigrationsFolder();
    if (picked) setFolder(picked);
  };

  const handleSave = async () => {
    if (!folder.trim() || !keyspace.trim()) return;
    setSaving(true);
    try {
      await onSave(folder.trim(), keyspace.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-[520px] px-6 py-8">
        <div className="flex items-center gap-2">
          <Settings2 size={14} strokeWidth={1.7} className="text-muted" />
          <h3 className="text-[14px] font-medium text-text">Configure migrations for {profile.name}</h3>
        </div>
        <p className="mt-1 text-[12px] text-muted">
          Each connection points at its own migrations folder. The app scans the folder for{" "}
          <code className="font-mono">.cql</code> files and tracks applied versions in the chosen keyspace.
        </p>

        <div className="mt-5 grid gap-3">
          <label className="grid gap-1 text-[11.5px] font-medium text-muted">
            Migrations folder
            <div className="flex items-center gap-1">
              <input
                className={inputClass}
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                placeholder="/path/to/migrations"
              />
              <Button type="button" onClick={() => void pickFolder()}>
                <FolderOpen size={13} strokeWidth={1.7} />
                <span>Browse</span>
              </Button>
            </div>
          </label>

          <label className="grid gap-1 text-[11.5px] font-medium text-muted">
            Target keyspace
            {keyspaceOptions.length > 0 ? (
              <Select value={keyspace} onValueChange={setKeyspace}>
                <SelectTrigger>
                  <SelectValue placeholder="Select keyspace..." />
                </SelectTrigger>
                <SelectContent>
                  {keyspaceOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <input
                className={inputClass}
                value={keyspace}
                onChange={(event) => setKeyspace(event.target.value)}
                placeholder="e.g. app_schema"
              />
            )}
            {!profile.connected ? (
              <span className="text-[11px] text-subtle">Not connected — typed value will be saved as-is.</span>
            ) : null}
          </label>

          <div className="mt-2 flex justify-end gap-1">
            {onCancel ? (
              <Button type="button" onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
            ) : null}
            <Button
              variant="primary"
              type="button"
              disabled={!folder.trim() || !keyspace.trim() || saving}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
