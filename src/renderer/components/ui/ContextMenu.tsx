import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";

const itemBaseClass =
  "relative flex w-full cursor-default select-none items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px] text-text outline-none transition-colors focus:bg-line-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

const surfaceClass =
  "z-50 min-w-[180px] overflow-hidden rounded-md border border-line bg-panel p-1 text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)]";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
const ContextMenuGroup = ContextMenuPrimitive.Group;
const ContextMenuPortal = ContextMenuPrimitive.Portal;
const ContextMenuSub = ContextMenuPrimitive.Sub;
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuSubTrigger = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }
>(({ className = "", inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={`${itemBaseClass} data-[state=open]:bg-line-soft ${inset ? "pl-7" : ""} ${className}`.trim()}
    {...props}
  >
    {children}
    <ChevronRight size={12} strokeWidth={1.7} className="ml-auto text-muted" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";

const ContextMenuSubContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className = "", ...props }, ref) => (
  <ContextMenuPrimitive.SubContent ref={ref} className={`${surfaceClass} ${className}`.trim()} {...props} />
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";

const ContextMenuContent = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className = "", ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content ref={ref} className={`${surfaceClass} ${className}`.trim()} {...props} />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

const ContextMenuItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
    variant?: "default" | "destructive";
  }
>(({ className = "", inset, variant = "default", ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={`${itemBaseClass} ${inset ? "pl-7" : ""} ${
      variant === "destructive" ? "text-danger focus:bg-danger/10 focus:text-danger" : ""
    } ${className}`.trim()}
    {...props}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

const ContextMenuCheckboxItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className = "", children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={`${itemBaseClass} pl-7 ${className}`.trim()}
    {...(checked === undefined ? {} : { checked })}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Check size={12} strokeWidth={1.8} />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName = "ContextMenuCheckboxItem";

const ContextMenuRadioItem = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className = "", children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={`${itemBaseClass} pl-7 ${className}`.trim()}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <Circle size={6} strokeWidth={0} fill="currentColor" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = "ContextMenuRadioItem";

const ContextMenuLabel = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & { inset?: boolean }
>(({ className = "", inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={`px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle ${inset ? "pl-7" : ""} ${className}`.trim()}
    {...props}
  />
));
ContextMenuLabel.displayName = "ContextMenuLabel";

const ContextMenuSeparator = forwardRef<
  ElementRef<typeof ContextMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className = "", ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={`my-1 h-px bg-line-soft ${className}`.trim()} {...props} />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";

function ContextMenuShortcut({ className = "", ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={`ml-auto text-[11px] tracking-[0.04em] text-subtle ${className}`.trim()} {...props} />;
}
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup
};
