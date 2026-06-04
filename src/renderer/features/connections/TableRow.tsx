import { memo } from "react";
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

/**
 * Wrapped in React.memo so re-renders triggered higher up the tree (status
 * store flips, modal open/close, etc.) don't ripple into every table row in
 * the sidebar. With memo, a Postgres profile that exposes thousands of
 * tables re-reconciles only the rows whose `active` flag actually flipped.
 * Pre-memo, even closing the Add dialog took noticeable time because every
 * row's ContextMenu got re-evaluated.
 *
 * Custom comparator: `onOpenTable` is passed down as a fresh closure on
 * every App render (the callback isn't wrapped in useCallback at the source
 * because the rest of the tree doesn't care). We compare only the props
 * that actually drive what TableRow paints, so memo isn't defeated by
 * identity-only churn on the handler.
 */
export const TableRow = memo(TableRowImpl, (prev, next) =>
  prev.active === next.active &&
  prev.label === next.label &&
  prev.keyspace === next.keyspace &&
  prev.identity.profileId === next.identity.profileId &&
  prev.identity.table === next.identity.table &&
  prev.identity.keyspace === next.identity.keyspace
);

function TableRowImpl({
  identity,
  keyspace,
  active,
  onOpenTable,
  label
}: {
  identity: TableIdentity;
  keyspace: string;
  active: boolean;
  onOpenTable(table: TableIdentity): Promise<void>;
  /** Optional display override (e.g. "orders (mview)") — identity.table stays
   *  the real object name so queries / copy actions are unaffected. */
  label?: string;
}) {
  const qualified = `${keyspace}.${identity.table}`;
  const copy = (value: string) => () => void navigator.clipboard.writeText(value);
  return (
    <li className="tree-row">
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
            <span className="truncate">{label ?? identity.table}</span>
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
