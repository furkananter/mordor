import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";

const itemBaseClass =
  "relative flex w-full cursor-default select-none items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12.5px] text-text outline-none transition-colors focus:bg-line-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

const surfaceClass =
  "z-50 min-w-[180px] overflow-hidden rounded-md border border-line bg-panel p-1 text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)]";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className = "", children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={`${itemBaseClass} data-[state=open]:bg-line-soft ${className}`.trim()}
    {...props}
  >
    {children}
    <ChevronRight size={12} strokeWidth={1.7} className="ml-auto text-muted" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className = "", ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent ref={ref} className={`${surfaceClass} ${className}`.trim()} {...props} />
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className = "", sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={`${surfaceClass} ${className}`.trim()}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    variant?: "default" | "destructive";
  }
>(({ className = "", variant = "default", ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={`${itemBaseClass} ${
      variant === "destructive" ? "text-danger focus:bg-danger/10 focus:text-danger" : ""
    } ${className}`.trim()}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className = "", children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={`${itemBaseClass} pl-7 ${className}`.trim()}
    {...(checked === undefined ? {} : { checked })}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check size={12} strokeWidth={1.8} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className = "", children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={`${itemBaseClass} pl-7 ${className}`.trim()}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle size={6} strokeWidth={0} fill="currentColor" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuLabel = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Label>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className = "", ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={`px-2 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-subtle ${className}`.trim()}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className = "", ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={`my-1 h-px bg-line-soft ${className}`.trim()} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
