import { useEffect } from "react";
import { defaultQueryForTable } from "../../lib/cql";
import { useQueryStore } from "../../store/query";
import { useLayoutStore } from "../../store/layout";
import { useSchemaStore } from "../../store/schema";
import { CqlPanel } from "./CqlPanel";
import { DataPanel } from "./DataPanel";
import { SchemaInspector } from "./SchemaInspector";
import { SchemaTab } from "./SchemaTab";
import { WorkspaceTabs } from "./WorkspaceTabs";

/**
 * Workspace shown when a specific table is selected. Renders the table-level
 * tab bar (Data · Schema · CQL) plus the schema inspector sidebar for the data
 * and CQL tabs. Reads everything from stores — no props needed.
 */
export function TableWorkspace() {
  const schema = useSchemaStore((state) => state.schema);
  const preview = useSchemaStore((state) => state.preview);
  const selectedTable = useSchemaStore((state) => state.selectedTable);
  const tableState = useSchemaStore((state) => state.tableState);
  const activeTab = useLayoutStore((state) => state.activeTab);
  const setActiveTab = useLayoutStore((state) => state.setActiveTab);
  const queryText = useQueryStore((state) => state.queryText);
  const queryResult = useQueryStore((state) => state.queryResult);
  const queryState = useQueryStore((state) => state.queryState);
  const setQueryText = useQueryStore((state) => state.setQueryText);
  const runQuery = useQueryStore((state) => state.runQuery);

  // Idle-prefetch CodeMirror as soon as a table workspace mounts. The CQL tab
  // is one click away and the editor chunk is ~150 KB gzipped; warming it
  // while the user is reading the data tab makes that switch instant.
  useEffect(() => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number });
    const fire = () => void import("../../components/ui/cql-editor/CqlEditor");
    if (idle.requestIdleCallback) idle.requestIdleCallback(fire);
    else window.setTimeout(fire, 1500);
  }, []);

  if (!selectedTable) return null;

  // Migrations is no longer a table-level tab — fall back to Data if persisted state is stale.
  const tab = activeTab === "migrations" ? "data" : activeTab;
  const showInspector = tab !== "schema";

  return (
    <div
      className={`grid min-h-0 flex-1 ${
        showInspector
          ? "grid-cols-[minmax(0,1fr)_minmax(220px,280px)] max-[980px]:grid-cols-1"
          : "grid-cols-1"
      }`}
    >
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
        <WorkspaceTabs activeTab={tab} onChange={setActiveTab} />
        <div
          key={tab}
          className="anim-fade-slide-up flex min-h-0 flex-1 flex-col"
        >
          {tab === "schema" ? (
            <SchemaTab schema={schema} />
          ) : tab === "cql" ? (
            <CqlPanel
              queryText={queryText}
              queryResult={queryResult}
              loading={queryState === "loading"}
              schema={schema}
              onChange={setQueryText}
              onRun={runQuery}
              placeholder={defaultQueryForTable(selectedTable)}
            />
          ) : (
            <DataPanel preview={preview} schema={schema} loading={tableState === "loading"} />
          )}
        </div>
      </section>
      {showInspector ? (
        <div className="max-[980px]:max-h-[220px]">
          <SchemaInspector schema={schema} />
        </div>
      ) : null}
    </div>
  );
}
