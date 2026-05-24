import { ReactNode } from "react";

export function PanelHeader({
  title,
  meta,
  actions
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[40px] items-center justify-between gap-2.5 border-b border-line-soft px-4 py-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[12px] font-medium text-text">{title}</h2>
        {meta ? <span className="text-[11.5px] text-muted">{meta}</span> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
