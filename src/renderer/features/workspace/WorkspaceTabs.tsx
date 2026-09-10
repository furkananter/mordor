import { SegmentedControl, SegmentedOption } from "../../components/ui/SegmentedControl";

// "migrations" and "benchmark" are intentionally kept in this union for the
// persisted layout store even though neither is offered at the table level —
// both live at the cluster level (migrations apply to keyspaces, benchmarks
// run scenarios cluster-wide, neither is scoped to one table).
export type WorkspaceTab = "data" | "schema" | "cql" | "migrations" | "benchmark";

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
