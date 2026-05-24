export function StatusPill({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel: string; inactiveLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-success" : "bg-subtle"}`} />
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}
