import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import { EmptyState } from "../../components/ui/EmptyState";
import { RedisSelection } from "../../store/redis";
import { ConnectionNode } from "./ConnectionNode";

export function ConnectionTree({
  profiles,
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
  profiles: ProfileListItem[];
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
  if (profiles.length === 0) {
    return <EmptyState title="No connections" body="Detect a local node or add a connection manually." compact />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1.5 py-2">
      <ul className="grid gap-0.5">
        {profiles.map((profile) => (
          <ConnectionNode
            key={profile.id}
            profile={profile}
            selectedTable={selectedTable}
            selectedProfileId={selectedProfileId}
            selectedRedis={selectedRedis}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onOpenTable={onOpenTable}
            onSelectProfile={onSelectProfile}
            onOpenRedisDb={onOpenRedisDb}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </div>
  );
}
