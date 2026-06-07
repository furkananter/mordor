import { memo } from "react";
import { ChevronDown, Download } from "lucide-react";
import type { KeyspaceNode as KeyspaceNodeData } from "../../../core/cassandra/CassandraService";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger
} from "../../components/ui/ContextMenu";
import { useExport } from "../export/useExport";
import { TableRow } from "./TableRow";

/**
 * Memoized for the same reason as PostgresSchemaList — large keyspaces would
 * otherwise re-render every table row on unrelated app-level state churn
 * (modal open/close, busy flag flips). The custom comparator ignores
 * `onOpenTable` identity since it's a fresh closure on every App render but
 * always points at the same store action.
 */
export const KeyspaceNode = memo(KeyspaceNodeImpl, (prev, next) =>
  prev.profile.id === next.profile.id &&
  prev.keyspace === next.keyspace &&
  prev.selectedTable?.profileId === next.selectedTable?.profileId &&
  prev.selectedTable?.keyspace === next.selectedTable?.keyspace &&
  prev.selectedTable?.table === next.selectedTable?.table
);

function KeyspaceNodeImpl({
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
  const { runExport, running: exportRunning } = useExport();
  const handleExportKeyspace = () => {
    void runExport({
      request: {
        profileId: profile.id,
        scope: "schema",
        schema: { keyspace: keyspace.name },
      },
      summary: `Exporting keyspace ${keyspace.name} (${profile.name})…`,
    });
  };
  return (
    <li>
      <details open className="group/keyspace">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <summary className="flex cursor-pointer items-center gap-1.5 rounded-ui px-1.5 py-1 text-[11.5px] text-muted hover:bg-line-soft/60 hover:text-text data-[state=open]:bg-line-soft">
              <ChevronDown
                size={11}
                strokeWidth={1.7}
                className="shrink-0 transition-transform group-open/keyspace:rotate-0 [details:not([open])>summary>&]:-rotate-90"
              />
              <span className="truncate">{keyspace.name}</span>
              <span className="ml-auto text-[10.5px] text-subtle">{keyspace.tables.length}</span>
            </summary>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>{`${profile.name} / ${keyspace.name}`}</ContextMenuLabel>
            <ContextMenuItem onSelect={handleExportKeyspace} disabled={Boolean(exportRunning)}>
              <Download size={11} strokeWidth={1.7} className="text-muted" />
              Export keyspace…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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

