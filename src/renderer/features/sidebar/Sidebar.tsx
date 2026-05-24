import { ChevronsLeft, ChevronsRight, Plus, Radar, Settings } from "lucide-react";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import { Button } from "../../components/ui/Button";
import { ConnectionTree } from "../connections/ConnectionTree";
import { RedisSelection } from "../../store/redis";

interface SidebarProps {
  profiles: ProfileListItem[];
  selectedTable: TableIdentity | undefined;
  selectedProfileId: string | undefined;
  busy: string | undefined;
  collapsed: boolean;
  showSettings: boolean;
  onDetectLocal(): Promise<void>;
  onAddConnection(): void;
  onEditConnection(profile: ProfileListItem): void;
  onDeleteConnection(profileId: string): Promise<void>;
  onShowSettings(): void;
  onShowHome(): void;
  onToggleCollapsed(): void;
  onResizeStart(event: React.MouseEvent): void;
  resizing: boolean;
  onConnect(profileId: string): Promise<void>;
  onDisconnect(profileId: string): Promise<void>;
  onOpenTable(table: TableIdentity): Promise<void>;
  onSelectProfile(profileId: string): void;
  selectedRedis: RedisSelection | undefined;
  onOpenRedisDb(selection: RedisSelection): void;
}

export function Sidebar({
  profiles,
  selectedTable,
  selectedProfileId,
  busy,
  collapsed,
  showSettings,
  onDetectLocal,
  onAddConnection,
  onEditConnection,
  onDeleteConnection,
  onShowSettings,
  onShowHome,
  onToggleCollapsed,
  onResizeStart,
  resizing,
  onConnect,
  onDisconnect,
  onOpenTable,
  onSelectProfile,
  selectedRedis,
  onOpenRedisDb
}: SidebarProps) {
  return (
    <aside
      className="sidebar-shell relative flex h-full min-h-0 min-w-0 flex-col border-r border-line"
      data-collapsed={collapsed ? "true" : "false"}
      aria-label="Connections"
    >
      <header className="sidebar-header drag-region shrink-0">
        <div className="sidebar-expanded-header">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <button
              type="button"
              onClick={onShowHome}
              title="Workspace home"
              className="no-drag flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 -mx-1 hover:bg-line-soft/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <img src="./app-icon.png" alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded-sm" />
              <span className="truncate text-[13px] font-semibold text-text">Mordor</span>
            </button>
            <div className="no-drag flex items-center gap-1.5">
              <Button variant="icon" onClick={onToggleCollapsed} tooltip="Collapse sidebar">
                <ChevronsLeft size={14} strokeWidth={1.7} />
              </Button>
            </div>
          </div>

          <div className="no-drag mt-2.5 flex items-center gap-0.5">
            <Button onClick={onDetectLocal} disabled={Boolean(busy)} tooltip="Detect local Cassandra">
              <Radar size={13} strokeWidth={1.7} />
              <span>Detect</span>
            </Button>
            <Button onClick={onAddConnection} tooltip="Add connection">
              <Plus size={13} strokeWidth={1.7} />
              <span>Add</span>
            </Button>
          </div>
        </div>

        <div className="sidebar-compact-header no-drag">
          <Button variant="icon" onClick={onToggleCollapsed} tooltip="Expand sidebar" tooltipPlacement="right">
            <ChevronsRight size={14} strokeWidth={1.7} />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="sidebar-pane sidebar-compact-pane absolute inset-0 flex min-h-0 flex-1 flex-col items-center gap-1 px-1.5 py-2">
          <Button variant="icon" onClick={onDetectLocal} disabled={Boolean(busy)} tooltip="Detect" tooltipPlacement="right">
            <Radar size={14} strokeWidth={1.7} />
          </Button>
          <Button variant="icon" onClick={onAddConnection} tooltip="Add" tooltipPlacement="right">
            <Plus size={14} strokeWidth={1.7} />
          </Button>

          <div className="mt-2 grid w-full gap-1" aria-label="Compact connections">
            {profiles.slice(0, 10).map((profile) => (
              <CompactProfileButton
                key={profile.id}
                profile={profile}
                onConnect={onConnect}
                onOpenTable={onOpenTable}
              />
            ))}
          </div>
        </div>

        <div className="sidebar-pane sidebar-expanded-pane absolute inset-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <ConnectionTree
            selectedRedis={selectedRedis}
            onOpenRedisDb={onOpenRedisDb}
            profiles={profiles}
            selectedTable={selectedTable}
            selectedProfileId={selectedProfileId}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onOpenTable={onOpenTable}
            onSelectProfile={onSelectProfile}
            onEdit={onEditConnection}
            onDelete={onDeleteConnection}
          />
        </div>
      </div>

      <footer className="no-drag shrink-0 border-t border-line-soft px-2 py-1.5">
        <div className="sidebar-expanded-footer flex items-center justify-between gap-2">
          <span className="truncate text-[10.5px] text-subtle">Built by Merovingian</span>
          <Button
            variant="icon"
            onClick={onShowSettings}
            tooltip="Settings"
            tooltipPlacement="left"
            className={showSettings ? "bg-line-soft text-text" : ""}
          >
            <Settings size={14} strokeWidth={1.7} />
          </Button>
        </div>
        <div className="sidebar-compact-footer flex items-center justify-center">
          <Button
            variant="icon"
            onClick={onShowSettings}
            tooltip="Settings"
            tooltipPlacement="right"
            className={showSettings ? "bg-line-soft text-text" : ""}
          >
            <Settings size={14} strokeWidth={1.7} />
          </Button>
        </div>
      </footer>

      <div
        className="sidebar-resize-handle no-drag"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        data-active={resizing ? "true" : "false"}
        onMouseDown={onResizeStart}
      />
    </aside>
  );
}

function CompactProfileButton({
  profile,
  onConnect,
  onOpenTable
}: {
  profile: ProfileListItem;
  onConnect(profileId: string): Promise<void>;
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  const defaultTable = getDefaultTable(profile);
  const disabled = profile.connected && !defaultTable;
  const action = profile.connected ? "Open first table" : "Connect";

  return (
    <Button
      variant="icon"
      className={`!h-8 !w-8 mx-auto text-[10px] font-semibold ${
        profile.connected ? "bg-accent-soft text-accent" : "bg-transparent text-muted"
      }`}
      disabled={disabled}
      onClick={() => {
        if (profile.connected) {
          if (defaultTable) void onOpenTable(defaultTable);
          return;
        }
        void onConnect(profile.id);
      }}
      tooltip={`${profile.name} - ${profile.connected ? "online" : "offline"} - ${action}`}
      tooltipPlacement="right"
    >
      {profile.name.slice(0, 2).toUpperCase()}
    </Button>
  );
}

function getDefaultTable(profile: ProfileListItem): TableIdentity | undefined {
  const keyspace = profile.schema[0];
  const table = keyspace?.tables[0];
  if (!keyspace || !table) return undefined;
  return {
    profileId: profile.id,
    profileName: profile.name,
    keyspace: keyspace.name,
    table: table.name
  };
}
