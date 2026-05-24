import { ButtonHTMLAttributes, Children, ReactElement, ReactNode, isValidElement } from "react";
import { Tooltip, TooltipPlacement } from "./Tooltip";

type Variant = "ghost" | "primary" | "danger" | "icon";

const variantClasses: Record<Variant, string> = {
  ghost:
    "px-2.5 py-1.5 text-text/85 hover:bg-line-soft hover:text-text disabled:text-subtle disabled:hover:bg-transparent",
  primary:
    "px-2.5 py-1.5 bg-accent text-white hover:bg-accent/90 disabled:bg-accent/40 disabled:text-white/80",
  danger:
    "px-2.5 py-1.5 text-danger hover:bg-danger/10 disabled:text-danger/40 disabled:hover:bg-transparent",
  icon:
    "h-7 w-7 p-0 text-muted hover:bg-line-soft hover:text-text disabled:text-subtle disabled:hover:bg-transparent"
};

const baseClassName =
  "no-drag inline-flex select-none items-center justify-center gap-1.5 rounded-ui text-[12px] font-medium leading-none transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: string;
  tooltipPlacement?: TooltipPlacement;
  variant?: Variant;
}

export function Button({
  type = "button",
  className = "",
  tooltip,
  tooltipPlacement,
  variant = "ghost",
  ...props
}: ButtonProps) {
  const button = (
    <button
      type={type}
      className={`${baseClassName} ${variantClasses[variant]} ${className}`.trim()}
      {...props}
    >
      {normalizeButtonChildren(props.children)}
    </button>
  );
  if (!tooltip) {
    return button;
  }
  return <Tooltip content={tooltip} placement={tooltipPlacement ?? "bottom"}>{button}</Tooltip>;
}

function normalizeButtonChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement(child) || typeof child.type === "string") {
      return child;
    }
    const element = child as ReactElement<{ className?: string }>;
    return {
      ...element,
      props: {
        ...element.props,
        className: ["shrink-0", element.props.className].filter(Boolean).join(" ")
      }
    };
  });
}
