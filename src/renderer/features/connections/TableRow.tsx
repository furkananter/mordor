import { Copy, Table2 } from "lucide-react";
import { TableIdentity } from "../../../core/shared/messages";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "../../components/ui/ContextMenu";

export function TableRow({
  identity,
  keyspace,
  active,
  onOpenTable
}: {
  identity: TableIdentity;
  keyspace: string;
  active: boolean;
  onOpenTable(table: TableIdentity): Promise<void>;
}) {
  const qualified = `${keyspace}.${identity.table}`;
  const copy = (value: string) => () => void navigator.clipboard.writeText(value);
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center gap-1.5 rounded-ui px-1.5 py-1 text-left text-[12px] data-[state=open]:bg-line-soft ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:bg-line-soft/60 hover:text-text"
            }`}
            onClick={() => onOpenTable(identity)}
          >
            <Table2 size={11} strokeWidth={1.7} className="shrink-0" />
            <span className="truncate">{identity.table}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>{qualified}</ContextMenuLabel>
          <ContextMenuItem onSelect={() => void onOpenTable(identity)}>
            <Table2 size={12} strokeWidth={1.7} className="text-muted" />
            Open table
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={copy(identity.table)}>
            <Copy size={11} strokeWidth={1.7} className="text-muted" />
            Copy table name
          </ContextMenuItem>
          <ContextMenuItem onSelect={copy(qualified)}>
            <Copy size={11} strokeWidth={1.7} className="text-muted" />
            Copy keyspace.table
          </ContextMenuItem>
          <ContextMenuItem onSelect={copy(`SELECT * FROM ${qualified} LIMIT 100;`)}>
            <Copy size={11} strokeWidth={1.7} className="text-muted" />
            Copy SELECT query
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}
