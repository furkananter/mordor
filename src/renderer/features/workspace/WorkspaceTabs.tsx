import { SegmentedControl, SegmentedOption } from "../../components/ui/SegmentedControl";

// Note: "migrations" is intentionally kept in the union for back-compat with the
// persisted layout store, but it is no longer offered at the table level — the
// Migrations tab lives at the cluster level since migrations apply to keyspaces,
// not individual tables.
export type WorkspaceTab = "data" | "schema" | "cql" | "migrations";

export function WorkspaceTabs({
  activeTab,
  onChange
}: {
  activeTab: WorkspaceTab;
  onChange(tab: WorkspaceTab): void;
}) {
  const options: SegmentedOption<WorkspaceTab>[] = [
    { value: "data", label: "Data" },
    { value: "schema", label: "Schema" },
    { value: "cql", label: "CQL" }
  ];

  return (
    <div className="border-b border-line-soft px-3">
      <SegmentedControl
        namespace="workspace-tabs"
        ariaLabel="Workspace tabs"
        value={activeTab}
        onChange={onChange}
        options={options}
      />
    </div>
  );
}
