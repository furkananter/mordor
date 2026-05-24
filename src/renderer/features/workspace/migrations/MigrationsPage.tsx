import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../../components/ui/EmptyState";
import { CassandraProfileListItem } from "../../../../core/ipc";
import { useConnectionStore } from "../../../store/connection";
import { useMigrationsStore } from "../../../store/migrations";
import { MigrationApplyDialog, PendingApply } from "./MigrationApplyDialog";
import { NewMigrationDialog } from "./NewMigrationDialog";
import { ProfileMigrations } from "./ProfileMigrations";

export function MigrationsPage({
  initialProfileId,
  lockedProfileId,
  embedded = false
}: {
  initialProfileId?: string;
  lockedProfileId?: string;
  embedded?: boolean;
} = {}) {
  const profiles = useConnectionStore((state) => state.profiles);
  const migrationsList = useMigrationsStore((state) => state.migrationsList);
  const migrationsState = useMigrationsStore((state) => state.migrationsState);
  const loadMigrations = useMigrationsStore((state) => state.loadMigrations);
  const applyMigration = useMigrationsStore((state) => state.applyMigration);
  const updateProfileMigrations = useMigrationsStore((state) => state.updateProfileMigrations);

  const cassandraProfiles = useMemo(
    () => profiles.filter((profile): profile is CassandraProfileListItem => profile.type === "cassandra"),
    [profiles]
  );
  const configuredProfiles = useMemo(
    () => cassandraProfiles.filter((profile) => profile.migrationsFolder && profile.migrationsKeyspace),
    [cassandraProfiles]
  );

  const [profileId, setProfileId] = useState<string | undefined>(
    () => lockedProfileId ?? initialProfileId ?? configuredProfiles[0]?.id
  );

  useEffect(() => {
    if (lockedProfileId && lockedProfileId !== profileId) {
      setProfileId(lockedProfileId);
    }
  }, [lockedProfileId, profileId]);

  useEffect(() => {
    if (lockedProfileId) return;
    if (!profileId && configuredProfiles[0]) setProfileId(configuredProfiles[0].id);
    if (profileId && !configuredProfiles.find((profile) => profile.id === profileId)) {
      setProfileId(configuredProfiles[0]?.id);
    }
  }, [configuredProfiles, profileId, lockedProfileId]);

  const profile = cassandraProfiles.find((entry) => entry.id === profileId);

  useEffect(() => {
    if (profile?.connected && profile.migrationsFolder && profile.migrationsKeyspace) {
      void loadMigrations(profile.id);
    }
  }, [profile?.id, profile?.connected, profile?.migrationsFolder, profile?.migrationsKeyspace, loadMigrations]);

  const [confirming, setConfirming] = useState<PendingApply | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [newMigrationOpen, setNewMigrationOpen] = useState(false);
  const [creatingMigration, setCreatingMigration] = useState(false);
  const [newMigrationName, setNewMigrationName] = useState("");
  const [newMigrationError, setNewMigrationError] = useState<string | undefined>(undefined);

  if (cassandraProfiles.length === 0) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-panel">
        <EmptyState title="No Cassandra connections" body="Add a Cassandra connection to configure migrations." />
      </section>
    );
  }

  const unconfiguredCount = cassandraProfiles.length - configuredProfiles.length;
  const pendingCount = migrationsList?.files.filter((file) => file.status === "pending").length ?? 0;

  const handleCreateMigration = async () => {
    if (!profile?.migrationsFolder) return;
    const name = newMigrationName.trim();
    if (!name) {
      setNewMigrationError("Name is required.");
      return;
    }
    setCreatingMigration(true);
    setNewMigrationError(undefined);
    try {
      await window.cassandraDesk.createMigration(profile.migrationsFolder, name);
      setNewMigrationOpen(false);
      setNewMigrationName("");
      if (profile.connected) await loadMigrations(profile.id);
    } catch (caught) {
      setNewMigrationError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreatingMigration(false);
    }
  };

  const handleConfirmedApply = async () => {
    if (!confirming || !profileId) return;
    setApplying(true);
    try {
      for (const version of confirming.versions) {
        const result = await applyMigration(profileId, version);
        if (result?.error) break;
      }
    } finally {
      setApplying(false);
      setConfirming(undefined);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-panel">
      {!embedded ? (
        <header className="border-b border-line-soft px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-text">Migrations</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Each connection points at its own migrations folder. Files are tracked via{" "}
            <code className="font-mono text-[11.5px]">schema_migrations</code>.
          </p>
        </header>
      ) : null}

      {!lockedProfileId ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-line-soft px-5 py-2">
          {configuredProfiles.length === 0 ? (
            <span className="text-[12px] text-muted">No connection has migrations configured.</span>
          ) : (
            configuredProfiles.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setProfileId(entry.id)}
                className={`flex items-center gap-1.5 rounded-ui px-2.5 py-1 text-[12px] transition-colors ${
                  entry.id === profileId ? "bg-line-soft text-text" : "text-muted hover:bg-line-soft/60 hover:text-text"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${entry.connected ? "bg-success" : "bg-subtle"}`} />
                {entry.name}
              </button>
            ))
          )}
          {unconfiguredCount > 0 ? (
            <span className="ml-2 text-[11px] text-subtle">
              {unconfiguredCount} other connection{unconfiguredCount === 1 ? "" : "s"} not configured
            </span>
          ) : null}
        </div>
      ) : null}

      {profile ? (
        <ProfileMigrations
          profile={profile}
          editing={editing}
          onEdit={() => setEditing(true)}
          onEditClose={() => setEditing(false)}
          onSave={async (folder, keyspace) => {
            await updateProfileMigrations(profile.id, folder, keyspace);
            setEditing(false);
          }}
          migrationsList={migrationsList}
          migrationsState={migrationsState}
          pendingCount={pendingCount}
          applying={applying}
          onReload={() => loadMigrations(profile.id)}
          onConfirmAll={() => {
            if (!migrationsList) return;
            const versions = migrationsList.files
              .filter((file) => file.status === "pending")
              .map((file) => file.version);
            if (versions.length > 0) setConfirming({ scope: "all", versions });
          }}
          onApplySingle={(version) => setConfirming({ scope: "single", versions: [version] })}
          onNewMigration={() => setNewMigrationOpen(true)}
          creatingMigration={creatingMigration}
        />
      ) : (
        <div className="grid flex-1 place-items-center p-6">
          <EmptyState
            title="Configure migrations on a connection"
            body="Open a connection's settings and set a migrations folder + keyspace."
            compact
          />
        </div>
      )}

      <MigrationApplyDialog
        pending={confirming}
        folder={profile?.migrationsFolder}
        profileLabel={profile?.name}
        keyspace={profile?.migrationsKeyspace}
        applying={applying}
        onConfirm={() => void handleConfirmedApply()}
        onCancel={() => setConfirming(undefined)}
      />

      <NewMigrationDialog
        open={newMigrationOpen}
        folder={profile?.migrationsFolder}
        name={newMigrationName}
        error={newMigrationError}
        creating={creatingMigration}
        onNameChange={setNewMigrationName}
        onConfirm={() => void handleCreateMigration()}
        onOpenChange={(open) => {
          if (creatingMigration) return;
          setNewMigrationOpen(open);
          if (!open) {
            setNewMigrationName("");
            setNewMigrationError(undefined);
          }
        }}
      />
    </section>
  );
}
