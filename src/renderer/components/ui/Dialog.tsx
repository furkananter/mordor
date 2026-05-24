import { ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button";

export function Dialog({
  open,
  title,
  description,
  children,
  size = "md",
  onOpenChange
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  onOpenChange(open: boolean): void;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  const maxWidth = size === "lg" ? "max-w-[640px]" : size === "sm" ? "max-w-[380px]" : "max-w-[480px]";

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4"
      role="presentation"
      onMouseDown={() => onOpenChange(false)}
    >
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`relative flex max-h-[min(720px,calc(100vh-32px))] w-full ${maxWidth} flex-col overflow-hidden rounded-lg border border-line bg-panel text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)]`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-5">
          <div className="grid gap-1">
            <h2 id={titleId} className="text-[15px] font-semibold leading-tight text-text">{title}</h2>
            {description ? (
              <p id={descriptionId} className="text-[12.5px] leading-[1.5] text-muted">{description}</p>
            ) : null}
          </div>
          <Button variant="icon" onClick={() => onOpenChange(false)} aria-label="Close dialog">
            <X size={14} strokeWidth={1.7} />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </section>
    </div>,
    document.body
  );
}
