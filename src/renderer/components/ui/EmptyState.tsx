export function EmptyState({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={`grid place-content-center gap-2 px-6 text-center ${compact ? "min-h-[140px]" : "min-h-[260px]"}`}>
      <strong className="text-[13px] font-medium text-text">{title}</strong>
      <span className="max-w-[320px] text-[12px] leading-[1.5] text-muted">{body}</span>
    </div>
  );
}
