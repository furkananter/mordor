import { MigrationHistoryEntry } from "../../../../core/shared/messages";
import { formatAppliedAt } from "./formatAppliedAt";

export function ActivityPanel({ history }: { history: MigrationHistoryEntry[] }) {
  return (
    <aside className="anim-fade-in w-[300px] min-w-0 shrink-0 overflow-y-auto border-l border-line-soft px-3 py-3">
      <span className="mb-2 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle">Activity</span>
      <ul className="grid gap-2 text-[11.5px]">
        {history.map((entry, index) => {
          const counts =
            entry.statementsExecuted != null && entry.totalStatements != null
              ? ` ${entry.statementsExecuted}/${entry.totalStatements}`
              : "";
          return (
            <li
              key={`${entry.version}-${entry.appliedAt}-${index}`}
              className="grid min-w-0 gap-0.5 border-b border-line-soft pb-2 last:border-b-0"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className={`min-w-0 flex-1 truncate font-medium ${entry.success ? "text-text" : "text-danger"}`}>
                  {entry.success ? "✓" : "✗"} {entry.filename}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-subtle">{formatAppliedAt(entry.appliedAt)}</span>
              </div>
              {entry.errorMessage ? (
                // `break-words` alone won't split tokens that have no whitespace
                // (e.g. `keyspace.tablename`); use `break-all` plus a max width
                // so long error sentences wrap inside the 300px panel.
                <p className="max-w-full whitespace-pre-wrap break-all font-mono text-[10.5px] leading-[1.4] text-danger">
                  {entry.errorMessage}
                </p>
              ) : (
                <span className="text-muted">applied{counts}</span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
