import { ChevronDown } from "lucide-react";
import type { KeyspaceNode as KeyspaceNodeData } from "../../../core/cassandra/CassandraService";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import { TableRow } from "./TableRow";

export function KeyspaceNode({
  profile,
  keyspace,
  selectedTable,
  onOpenTable
}: {
  profile: ProfileListItem;
  keyspace: KeyspaceNodeData;
  selectedTable: TableIdentity | undefined;
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  return (
    <li>
      <details open className="group/keyspace">
        <summary className="flex cursor-pointer items-center gap-1.5 rounded-ui px-1.5 py-1 text-[11.5px] text-muted hover:bg-line-soft/60 hover:text-text">
          <ChevronDown
            size={11}
            strokeWidth={1.7}
            className="shrink-0 transition-transform group-open/keyspace:rotate-0 [details:not([open])>summary>&]:-rotate-90"
          />
          <span className="truncate">{keyspace.name}</span>
          <span className="ml-auto text-[10.5px] text-subtle">{keyspace.tables.length}</span>
        </summary>
        <ul className="ml-3 grid gap-px border-l border-line-soft pl-2">
          {keyspace.tables.map((table) => {
            const identity: TableIdentity = {
              profileId: profile.id,
              profileName: profile.name,
              keyspace: keyspace.name,
              table: table.name
            };
            const active =
              selectedTable?.profileId === profile.id &&
              selectedTable.keyspace === keyspace.name &&
              selectedTable.table === table.name;
            return (
              <TableRow
                key={table.name}
                identity={identity}
                keyspace={keyspace.name}
                active={active}
                onOpenTable={onOpenTable}
              />
            );
          })}
        </ul>
      </details>
    </li>
  );
}
