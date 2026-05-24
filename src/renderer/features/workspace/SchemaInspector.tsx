import { useMemo } from "react";
import { TableSchemaPayload } from "../../../core/shared/messages";
import { PanelHeader } from "../../components/ui/PanelHeader";
import { Skeleton } from "../../components/ui/Skeleton";

type ColumnKind = TableSchemaPayload["columns"][number]["kind"];

export function SchemaInspector({ schema }: { schema: TableSchemaPayload | undefined }) {
  const keyCount = (schema?.partitionKeys.length ?? 0) + (schema?.clusteringKeys.length ?? 0);
  const groups = useMemo(() => groupColumns(schema?.columns ?? []), [schema]);

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-line bg-panel" aria-label="Schema inspector">
      <PanelHeader title="Schema" meta={schema ? `${schema.columns.length} cols · ${keyCount} keys` : ""} />
      {schema ? (
        <div className="min-h-0 overflow-auto px-3 pb-3 pt-1">
          <ColumnGroup title="Partition" columns={groups.partition_key} />
          <ColumnGroup title="Clustering" columns={groups.clustering} />
          <ColumnGroup title="Static" columns={groups.static} />
          <ColumnGroup title="Regular" columns={groups.regular} />
        </div>
      ) : (
        <div className="grid gap-3 px-3 pb-3 pt-2">
          {[8, 6, 4].map((count, group) => (
            <section key={group}>
              <Skeleton width={64} height={10} className="mb-1.5" />
              <div className="grid gap-1.5">
                {Array.from({ length: count }, (_, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1">
                    <Skeleton height={12} width={`${50 + ((index * 13) % 40)}%`} />
                    <Skeleton height={11} width={36 + ((index * 7) % 20)} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

function ColumnGroup({ title, columns }: { title: string; columns: TableSchemaPayload["columns"] }) {
  if (columns.length === 0) return null;
  return (
    <section className="mt-3 first:mt-2">
      <h3 className="mb-1 flex items-center justify-between text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">
        <span>{title}</span>
        <span>{columns.length}</span>
      </h3>
      <ul className="grid gap-px">
        {columns.map((column) => (
          <li key={column.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1 text-[12px]">
            <span className="truncate text-text">{column.name}</span>
            <code className="truncate font-mono text-[11px] text-muted">{column.type}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function groupColumns(columns: TableSchemaPayload["columns"]): Record<ColumnKind, TableSchemaPayload["columns"]> {
  return columns.reduce<Record<ColumnKind, TableSchemaPayload["columns"]>>(
    (groups, column) => {
      groups[column.kind].push(column);
      return groups;
    },
    { partition_key: [], clustering: [], static: [], regular: [] }
  );
}
