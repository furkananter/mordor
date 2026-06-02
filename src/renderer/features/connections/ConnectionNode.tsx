import { memo, ReactNode, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Pencil,
  Plug,
  PlugZap,
  RefreshCw,
  Settings,
  Trash2
} from "lucide-react";
import { profileAddress } from "../../../core/config/profile";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "../../components/ui/ContextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../components/ui/DropdownMenu";
import { KeyspaceNode } from "./KeyspaceNode";
import { PostgresSchemaList } from "./PostgresSchemaList";
import { RedisDbList } from "./RedisDbList";
import { useConnectionStore } from "../../store/connection";
import { RedisSelection } from "../../store/redis";

type ActionEntry =
  | { kind: "separator" }
  | {
      kind: "item";
      label: string;
      icon: ReactNode;
      onSelect(): void;
      variant?: "destructive";
    };

// Memoized: a single connection row (plus its Radix menus, AlertDialog, and
// keyspace/table children) should only re-render when its own props change —
// not on every App-level `busy`/selection churn. Props from App are stable
// (useCallback'd handlers + store actions); `profile` keeps its reference
// across unrelated updates.
export const ConnectionNode = memo(function ConnectionNode({
  profile,
  selectedTable,
  selectedProfileId,
  selectedRedis,
  onConnect,
  onDisconnect,
  onOpenTable,
  onSelectProfile,
  onOpenRedisDb,
  onEdit,
  onDelete
}: {
  profile: ProfileListItem;
  selectedTable: TableIdentity | undefined;
  selectedProfileId: string | undefined;
  selectedRedis: RedisSelection | undefined;
  onConnect(profileId: string): Promise<void>;
  onDisconnect(profileId: string): Promise<void>;
  onOpenTable(table: TableIdentity): Promise<void>;
  onSelectProfile(profileId: string): void;
  onOpenRedisDb(selection: RedisSelection): void;
  onEdit(profile: ProfileListItem): void;
  onDelete(profileId: string): Promise<void>;
}) {
  const [expanded, setExpanded] = useState(profile.connected);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const displayName = profile.name.replace(/\s*\([^)]*\)\s*$/, "");
  const address = profileAddress(profile);

  // Hoist the menu/context-menu actions to a memo. With many profiles in the
  // sidebar, each render of ConnectionNode would otherwise build a fresh array
  // plus six Lucide `React.createElement` icons — measurable noise when the
  // connection store changes frequently (live polling, refresh, etc.).
  const actions: ActionEntry[] = useMemo(() => {
    const copyAddress = () => {
      void navigator.clipboard.writeText(address);
    };
    return [
      profile.connected
        ? {
            kind: "item",
            label: "Disconnect",
            icon: <Plug size={12} strokeWidth={1.7} className="text-muted" />,
            onSelect: () => void onDisconnect(profile.id)
          }
        : {
            kind: "item",
            label: "Connect",
            icon: <PlugZap size={12} strokeWidth={1.7} className="text-accent" />,
            onSelect: () => void onConnect(profile.id)
          },
      ...(profile.connected && profile.type === "cassandra"
        ? ([
            {
              kind: "item",
              label: "Refresh schema",
              icon: <RefreshCw size={12} strokeWidth={1.7} className="text-muted" />,
              // Connect() returns the cached schema when already connected, so a
              // straight "Reconnect" wouldn't notice DDL changes made outside
              // this app. refreshClusterSchema explicitly re-reads
              // system_schema and updates the sidebar tree.
              onSelect: () => void useConnectionStore.getState().refreshClusterSchema(profile.id)
            }
          ] as ActionEntry[])
        : []),
      { kind: "separator" },
      {
        kind: "item",
        label: "Edit connection",
        icon: <Pencil size={11} strokeWidth={1.7} className="text-muted" />,
        onSelect: () => onEdit(profile)
      },
      {
        kind: "item",
        label: "Copy address",
        icon: <Copy size={11} strokeWidth={1.7} className="text-muted" />,
        onSelect: copyAddress
      },
      { kind: "separator" },
      {
        kind: "item",
        label: "Delete connection",
        icon: <Trash2 size={11} strokeWidth={1.7} />,
        onSelect: () => setConfirmDelete(true),
        variant: "destructive"
      }
    ];
  }, [profile, address, onConnect, onDisconnect, onEdit]);

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`group flex items-center gap-1 rounded-ui px-1.5 py-1 hover:bg-line-soft/60 data-[state=open]:bg-line-soft ${
              (profile.type === "cassandra" || profile.type === "postgres") && selectedProfileId === profile.id ? "bg-accent-soft/50" : ""
            }`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => {
                setExpanded((value) => !value);
                // Both Cassandra and Postgres open a cluster-level workspace
                // (CQL/SQL console) when selected. Redis routes to its DB list
                // via a different handler, so it stays out of this branch.
                if (profile.connected && (profile.type === "cassandra" || profile.type === "postgres")) {
                  onSelectProfile(profile.id);
                }
              }}
            >
              {profile.connected ? (
                expanded ? (
                  <ChevronDown size={12} strokeWidth={1.7} className="shrink-0 text-muted" />
                ) : (
                  <ChevronRight size={12} strokeWidth={1.7} className="shrink-0 text-muted" />
                )
              ) : (
                <Circle size={6} strokeWidth={0} fill="currentColor" className="ml-[3px] mr-[3px] shrink-0 text-subtle" />
              )}
              <span className="min-w-0 truncate text-[12.5px] text-text">{displayName}</span>
              {profile.connected ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" /> : null}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Open ${displayName} settings`}
                  className="shrink-0 rounded-sm p-0.5 text-subtle opacity-0 transition-opacity hover:bg-line-soft hover:text-text focus-visible:opacity-100 data-[state=open]:opacity-100 group-hover:opacity-100"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Settings size={12} strokeWidth={1.7} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4}>
                <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
                {actions.map((action, index) =>
                  action.kind === "separator" ? (
                    <DropdownMenuSeparator key={`sep-${index}`} />
                  ) : (
                    <DropdownMenuItem
                      key={action.label}
                      onSelect={action.onSelect}
                      {...(action.variant === "destructive" ? { variant: "destructive" as const } : {})}
                    >
                      {action.icon}
                      {action.label}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{displayName}</ContextMenuLabel>
          {actions.map((action, index) =>
            action.kind === "separator" ? (
              <ContextMenuSeparator key={`sep-${index}`} />
            ) : (
              <ContextMenuItem
                key={action.label}
                onSelect={action.onSelect}
                {...(action.variant === "destructive" ? { variant: "destructive" as const } : {})}
              >
                {action.icon}
                {action.label}
              </ContextMenuItem>
            )
          )}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this connection?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-text">{profile.name}</strong> will be removed along with its stored password. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => void onDelete(profile.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!expanded ? <p className="ml-6 truncate text-[11px] text-subtle">{address}</p> : null}

      {expanded && profile.connected ? (
        <ul className="ml-3 mt-0.5 grid gap-px border-l border-line-soft pl-2">
          {profile.type === "redis" ? (
            <RedisDbList
              profileId={profile.id}
              profileName={profile.name}
              connected={profile.connected}
              selected={selectedRedis}
              onSelect={onOpenRedisDb}
            />
          ) : profile.schema.kind === "cassandra" ? (
            profile.schema.keyspaces.map((keyspace) => (
              <KeyspaceNode
                key={keyspace.name}
                profile={profile}
                keyspace={keyspace}
                selectedTable={selectedTable}
                onOpenTable={onOpenTable}
              />
            ))
          ) : profile.schema.kind === "postgres" ? (
            profile.schema.schemas.map((schema) => (
              <PostgresSchemaList
                key={schema.name}
                profile={profile}
                schema={schema}
                selectedTable={selectedTable}
                onOpenTable={onOpenTable}
              />
            ))
          ) : null}
        </ul>
      ) : null}
    </li>
  );
});
