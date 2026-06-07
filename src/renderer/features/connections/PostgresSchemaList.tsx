import { memo } from "react";
import { ChevronDown, Download } from "lucide-react";
import type { PostgresSchemaNode } from "../../../core/postgres/types";
import { ProfileListItem } from "../../../core/ipc";
import { TableIdentity } from "../../../core/shared/messages";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger
} from "../../components/ui/ContextMenu";
import { useExport } from "../export/use-export";
import { TableRow } from "./TableRow";

/**
 * Sidebar tree for a connected Postgres profile: one collapsible block per
 * schema, with tables and views grouped underneath. View entries reuse the
 * generic TableRow (they read identically once selected — same preview SQL,
 * same DataPanel). Materialized views are tagged in the label so the user
 * can spot them at a glance.
 *
 * `keyspace` on TableIdentity carries the schema name here — see schemaHandlers
 * for the rationale on the temporary naming overload.
 *
 * Wrapped in memo so unrelated app-wide state changes (Add dialog open/close,
 * busy flag flips) don't re-render every schema block on a Postgres profile
 * with hundreds of schemas.
 */
export const PostgresSchemaList = memo(PostgresSchemaListImpl, (prev, next) =>
  prev.profile.id === next.profile.id &&
  prev.schema === next.schema &&
  prev.selectedTable?.profileId === next.selectedTable?.profileId &&
  prev.selectedTable?.keyspace === next.selectedTable?.keyspace &&
  prev.selectedTable?.table === next.selectedTable?.table
);

function PostgresSchemaListImpl({
  profile,
  schema,
  selectedTable,
  onOpenTable
}: {
  profile: ProfileListItem;
  schema: PostgresSchemaNode;
  selectedTable: TableIdentity | undefined;
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  const childCount = schema.tables.length + schema.views.length;
  const { runExport, running: exportRunning } = useExport();
  const handleExportSchema = () => {
    void runExport({
      request: {
        profileId: profile.id,
        scope: "schema",
        schema: { keyspace: schema.name },
      },
      summary: `Exporting schema ${schema.name} (${profile.name})…`,
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
              <span className="truncate">{schema.name}</span>
              <span className="ml-auto text-[10.5px] text-subtle">{childCount}</span>
            </summary>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>{`${profile.name} / ${schema.name}`}</ContextMenuLabel>
            <ContextMenuItem onSelect={handleExportSchema} disabled={Boolean(exportRunning)}>
              <Download size={11} strokeWidth={1.7} className="text-muted" />
              Export schema…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <ul className="ml-3 grid gap-px border-l border-line-soft pl-2">
          {schema.tables.map((table) => {
            const identity: TableIdentity = {
              profileId: profile.id,
              profileName: profile.name,
              keyspace: schema.name,
              table: table.name
            };
            const active =
              selectedTable?.profileId === profile.id &&
              selectedTable.keyspace === schema.name &&
              selectedTable.table === table.name;
            return (
              <TableRow
                key={`t-${table.name}`}
                identity={identity}
                keyspace={schema.name}
                active={active}
                onOpenTable={onOpenTable}
              />
            );
          })}
          {schema.views.map((view) => {
            const identity: TableIdentity = {
              profileId: profile.id,
              profileName: profile.name,
              keyspace: schema.name,
              table: view.name
            };
            const active =
              selectedTable?.profileId === profile.id &&
              selectedTable.keyspace === schema.name &&
              selectedTable.table === view.name;
            const label = view.materialized ? `${view.name} (mview)` : `${view.name} (view)`;
            return (
              <TableRow
                key={`v-${view.name}`}
                identity={identity}
                keyspace={schema.name}
                active={active}
                onOpenTable={onOpenTable}
                label={label}
              />
            );
          })}
        </ul>
      </details>
    </li>
  );
}
