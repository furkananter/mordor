import { CSSProperties, ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TooltipPlacement = "top" | "right" | "bottom" | "left";

export function Tooltip({
  content,
  children,
  placement = "bottom"
}: {
  content: ReactNode;
  children: ReactNode;
  placement?: TooltipPlacement;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  const rect = anchorRef.current?.getBoundingClientRect();
  const position = rect ? getTooltipPosition(rect, placement) : undefined;

  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const node = tooltipRef.current;
    const margin = 8;
    const box = node.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (box.left < margin) dx = margin - box.left;
    else if (box.right > vw - margin) dx = vw - margin - box.right;
    if (box.top < margin) dy = margin - box.top;
    else if (box.bottom > vh - margin) dy = vh - margin - box.bottom;
    node.style.translate = `${dx}px ${dy}px`;
  }, [visible, position?.left, position?.top]);

  return (
    <span
      ref={anchorRef}
      aria-describedby={visible ? id : undefined}
      className="relative inline-flex"
      onBlur={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && rect
        ? createPortal(
            <span
              ref={tooltipRef}
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-text/90 px-2 py-1 text-[11px] text-panel"
              style={position}
            >
              {content}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

function getTooltipPosition(rect: DOMRect, placement: TooltipPlacement): CSSProperties {
  const gap = 6;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  if (placement === "right") {
    return { left: rect.right + gap, top: centerY, transform: "translateY(-50%)" };
  }
  if (placement === "left") {
    return { left: rect.left - gap, top: centerY, transform: "translate(-100%, -50%)" };
  }
  if (placement === "top") {
    return { left: centerX, top: rect.top - gap, transform: "translate(-50%, -100%)" };
  }
  return { left: centerX, top: rect.bottom + gap, transform: "translateX(-50%)" };
}
