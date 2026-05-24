import { useEffect, useState } from "react";
import { AlertTriangle, FilePlus2, FolderOpen, Pencil, Play, RefreshCw } from "lucide-react";
import { CassandraProfileListItem } from "../../../../core/ipc";
import { Button } from "../../../components/ui/Button";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useMigrationsStore } from "../../../store/migrations";
import { ActivityPanel } from "./ActivityPanel";
import { ConfigEditor } from "./ConfigEditor";
import { MigrationEditorDrawer } from "./MigrationEditorDrawer";
import { MigrationRow } from "./MigrationRow";

export function ProfileMigrations({
  profile,
  editing,
  onEdit,
  onEditClose,
  onSave,
  migrationsList,
  migrationsState,
  pendingCount,
  applying,
  onReload,
  onConfirmAll,
  onApplySingle,
  onNewMigration,
  creatingMigration
}: {
  profile: CassandraProfileListItem;
  editing: boolean;
  onEdit(): void;
  onEditClose(): void;
  onSave(folder: string, keyspace: string): Promise<void>;
  migrationsList: ReturnType<typeof useMigrationsStore.getState>["migrationsList"];
  migrationsState: ReturnType<typeof useMigrationsStore.getState>["migrationsState"];
  pendingCount: number;
  applying: boolean;
  onReload(): void;
  onConfirmAll(): void;
  onApplySingle(version: string): void;
  onNewMigration(): void;
  creatingMigration: boolean;
}) {
  const hasConfig = Boolean(profile.migrationsFolder && profile.migrationsKeyspace);
  const [editingFilename, setEditingFilename] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!migrationsList) return;
    if (editingFilename && !migrationsList.files.some((file) => file.filename === editingFilename)) {
      setEditingFilename(undefined);
    }
  }, [migrationsList, editingFilename]);

  if (!hasConfig || editing) {
    return <ConfigEditor profile={profile} onCancel={hasConfig ? onEditClose : undefined} onSave={onSave} />;
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-5 py-2.5">
        <div className="grid gap-0.5 text-[12px]">
          <div className="flex items-center gap-1.5">
            <FolderOpen size={12} strokeWidth={1.7} className="text-muted" />
            <span className="truncate text-text">{profile.migrationsFolder}</span>
          </div>
          <span className="text-[11.5px] text-muted">
            Target: <span className="text-text">{profile.migrationsKeyspace}</span>
            {migrationsList ? (
              <>
                {" "}
                · <span className="text-text">{migrationsList.files.length}</span> files · {pendingCount} pending
                {!migrationsList.trackingTableReady && (
                  <span className="ml-2 inline-flex items-center gap-1 text-warning">
                    <AlertTriangle size={11} /> tracking table will be created
                  </span>
                )}
              </>
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={onEdit} tooltip="Edit configuration">
            <Pencil size={11} strokeWidth={1.7} />
            <span>Configure</span>
          </Button>
          <Button
            onClick={onReload}
            disabled={!profile.connected || migrationsState === "loading"}
            tooltip={profile.connected ? "Reload" : "Connect to reload"}
          >
            <RefreshCw size={12} strokeWidth={1.7} />
            <span>Reload</span>
          </Button>
          <Button onClick={onNewMigration} disabled={creatingMigration} tooltip="Create new migration file">
            <FilePlus2 size={12} strokeWidth={1.7} />
            <span>{creatingMigration ? "Creating…" : "New"}</span>
          </Button>
          <Button
            variant="primary"
            disabled={!profile.connected || pendingCount === 0 || applying}
            onClick={onConfirmAll}
          >
            <Play size={12} strokeWidth={1.7} />
            <span>Apply pending ({pendingCount})</span>
          </Button>
        </div>
      </div>

      {!profile.connected ? (
        <div className="border-b border-line-soft bg-warning/5 px-5 py-2 text-[12px] text-warning">
          Connect to <span className="font-medium">{profile.name}</span> to load and apply migrations.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {migrationsState === "loading" && !migrationsList ? (
            <SkeletonList rows={6} />
          ) : migrationsList?.files.length ? (
            <ul className="grid">
              {migrationsList.files.map((file) => (
                <MigrationRow
                  key={file.version}
                  file={file}
                  active={editingFilename === file.filename}
                  disabled={applying || file.status === "applied" || !profile.connected}
                  onOpen={() => setEditingFilename(file.filename)}
                  onApply={() => onApplySingle(file.version)}
                />
              ))}
            </ul>
          ) : (
            <div className="grid h-full place-items-center p-6">
              <EmptyState
                title={profile.connected ? "No migration files" : "Not connected"}
                body={
                  profile.connected
                    ? "Add .cql files to the configured folder."
                    : "Connect to this cluster to scan the configured folder."
                }
                compact
              />
            </div>
          )}
        </div>
        {editingFilename && profile.migrationsFolder ? (
          <MigrationEditorDrawer
            folder={profile.migrationsFolder}
            filename={editingFilename}
            onClose={() => setEditingFilename(undefined)}
            onSaved={onReload}
          />
        ) : migrationsList && migrationsList.history.length > 0 ? (
          <ActivityPanel history={migrationsList.history} />
        ) : null}
      </div>
    </>
  );
}
