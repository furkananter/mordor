import { useMemo } from "react";
import { ArrowRight, Clock, Database, Pencil, Plug, PlugZap, Plus, Radar, Table2 } from "lucide-react";
import { profileAddress } from "../../../core/config/profile";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import { Button } from "../../components/ui/Button";
import { useRecentTablesStore } from "../../store/recentTables";

export function WorkspaceHome({
  profiles,
  busy,
  onDetectLocal,
  onAddConnection,
  onEditConnection,
  onConnect,
  onDisconnect,
  onOpenTable
}: {
  profiles: ProfileListItem[];
  busy: string | undefined;
  onDetectLocal(): Promise<void>;
  onAddConnection(): void;
  onEditConnection(profile: ProfileListItem): void;
  onConnect(profileId: string): Promise<void>;
  onDisconnect(profileId: string): Promise<void>;
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  const recents = useRecentTablesStore((state) => state.recents);

  const validRecents = useMemo(() => {
    const profileIds = new Set(profiles.map((profile) => profile.id));
    return recents.filter((entry) => profileIds.has(entry.table.profileId));
  }, [recents, profiles]);

  // Stats are Cassandra-only for now: Redis has no keyspace/table model and
  // each new database (postgres → schemas, mongo → collections) will need its
  // own counters. Once the second non-Cassandra DB lands, this should be
  // generalized into a per-profile "schema summary" helper.
  const totalKeyspaces = profiles.reduce(
    (sum, profile) =>
      profile.schema.kind === "cassandra" ? sum + profile.schema.keyspaces.length : sum,
    0
  );
  const totalTables = profiles.reduce(
    (sum, profile) =>
      profile.schema.kind === "cassandra"
        ? sum + profile.schema.keyspaces.reduce((s, ks) => s + ks.tables.length, 0)
        : sum,
    0
  );
  const onlineCount = profiles.filter((profile) => profile.connected).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-panel">
      <div className="mx-auto w-full max-w-[960px] px-6 py-8">
        <header className="flex items-end justify-between gap-4 border-b border-line-soft pb-5">
          <div className="grid gap-1">
            <h2 className="text-[20px] font-semibold tracking-tight text-text">Welcome back</h2>
            <p className="text-[12.5px] text-muted">
              {profiles.length === 0
                ? "Add a connection or detect a local Cassandra to get started."
                : "Pick a connection or jump back into a recent table."}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button onClick={onDetectLocal} disabled={Boolean(busy)} tooltip="Detect local Cassandra">
              <Radar size={13} strokeWidth={1.7} />
              <span>Detect</span>
            </Button>
            <Button variant="primary" onClick={onAddConnection}>
              <Plus size={13} strokeWidth={1.7} />
              <span>Add connection</span>
            </Button>
          </div>
        </header>

        {profiles.length > 0 ? (
          <div className="mt-5 grid grid-cols-3 gap-3 text-[11.5px] text-muted">
            <Stat label="Connections" value={`${profiles.length}`} subtle={`${onlineCount} online`} />
            <Stat label="Keyspaces" value={`${totalKeyspaces}`} subtle="across connected clusters" />
            <Stat label="Tables" value={`${totalTables}`} subtle="across keyspaces" />
          </div>
        ) : null}

        <Section title="Connections" hint={profiles.length === 0 ? "No saved connections yet." : undefined}>
          {profiles.length === 0 ? null : (
            <ul className="grid grid-cols-1 gap-2 min-[820px]:grid-cols-2">
              {profiles.map((profile) => (
                <ConnectionCard
                  key={profile.id}
                  profile={profile}
                  onConnect={onConnect}
                  onDisconnect={onDisconnect}
                  onEdit={onEditConnection}
                  onOpenTable={onOpenTable}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Recent tables"
          hint={validRecents.length === 0 ? "Open a table from the sidebar to see it here." : undefined}
        >
          {validRecents.length === 0 ? null : (
            <ul className="grid gap-px overflow-hidden rounded-ui border border-line-soft">
              {validRecents.map((entry) => (
                <RecentTableRow key={recentKey(entry.table)} entry={entry} onOpenTable={onOpenTable} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, subtle }: { label: string; value: string; subtle: string }) {
  return (
    <div className="grid gap-0.5 rounded-ui border border-line-soft bg-panel-soft px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</span>
      <span className="text-[18px] font-semibold text-text">{value}</span>
      <span className="text-[11px] text-muted">{subtle}</span>
    </div>
  );
}

function Section({
  title,
  hint,
  children
}: {
  title: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7 grid gap-3">
      <div className="flex items-end justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function ConnectionCard({
  profile,
  onConnect,
  onDisconnect,
  onEdit,
  onOpenTable
}: {
  profile: ProfileListItem;
  onConnect(profileId: string): Promise<void>;
  onDisconnect(profileId: string): Promise<void>;
  onEdit(profile: ProfileListItem): void;
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  const displayName = profile.name.replace(/\s*\([^)]*\)\s*$/, "");
  const address =
    profile.type === "redis"
      ? `${profile.host}:${profile.port} · db ${profile.db}`
      : profileAddress(profile);
  const keyspaceCount =
    profile.schema.kind === "cassandra" ? profile.schema.keyspaces.length : 0;
  const tableCount =
    profile.schema.kind === "cassandra"
      ? profile.schema.keyspaces.reduce((sum, ks) => sum + ks.tables.length, 0)
      : 0;
  const defaultTable = getDefaultTable(profile);

  return (
    <li className="grid gap-2 rounded-ui border border-line-soft bg-panel-soft px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${profile.connected ? "bg-success" : "bg-subtle"}`} />
            <span className="truncate text-[13px] font-medium text-text">{displayName}</span>
          </div>
          <span className="truncate font-mono text-[11px] text-subtle">{address}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={() => onEdit(profile)} tooltip="Edit connection">
            <Pencil size={11} strokeWidth={1.7} />
            <span>Edit</span>
          </Button>
          {profile.connected ? (
            <Button onClick={() => void onDisconnect(profile.id)} tooltip="Disconnect">
              <Plug size={11} strokeWidth={1.7} />
              <span>Disconnect</span>
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void onConnect(profile.id)} tooltip="Connect">
              <PlugZap size={11} strokeWidth={1.7} />
              <span>Connect</span>
            </Button>
          )}
        </div>
      </div>

      {profile.connected ? (
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <Database size={11} strokeWidth={1.7} className="text-subtle" />
            <span>
              <span className="text-text">{keyspaceCount}</span> keyspaces ·{" "}
              <span className="text-text">{tableCount}</span> tables
            </span>
          </span>
          {defaultTable ? (
            <button
              type="button"
              onClick={() => void onOpenTable(defaultTable)}
              className="flex items-center gap-1 text-accent hover:underline"
            >
              Open first table
              <ArrowRight size={11} strokeWidth={1.7} />
            </button>
          ) : null}
        </div>
      ) : (
        <span className="text-[11.5px] text-subtle">Connect to view keyspaces and tables.</span>
      )}
    </li>
  );
}

function RecentTableRow({
  entry,
  onOpenTable
}: {
  entry: { table: TableIdentity; openedAt: number };
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  const { table } = entry;
  return (
    <li>
      <button
        type="button"
        onClick={() => void onOpenTable(table)}
        className="flex w-full items-center gap-2 bg-panel px-3 py-2 text-left hover:bg-line-soft/60"
      >
        <Table2 size={12} strokeWidth={1.7} className="shrink-0 text-subtle" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[12.5px] text-text">{table.keyspace}.{table.table}</span>
          <span className="truncate text-[11px] text-muted">{table.profileName}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-subtle">
          <Clock size={10} strokeWidth={1.7} />
          {formatRelative(entry.openedAt)}
        </span>
      </button>
    </li>
  );
}

function recentKey(table: TableIdentity): string {
  return `${table.profileId}:${table.keyspace}:${table.table}`;
}

function getDefaultTable(profile: ProfileListItem): TableIdentity | undefined {
  if (profile.schema.kind !== "cassandra") return undefined;
  const keyspace = profile.schema.keyspaces[0];
  const table = keyspace?.tables[0];
  if (!keyspace || !table) return undefined;
  return {
    profileId: profile.id,
    profileName: profile.name,
    keyspace: keyspace.name,
    table: table.name
  };
}

function formatRelative(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
