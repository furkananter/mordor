import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className = "", children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={`flex h-8 w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 text-[12.5px] text-text outline-none transition-colors hover:border-line-strong focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted data-[invalid]:border-danger data-[invalid]:ring-1 data-[invalid]:ring-danger/40 ${className}`.trim()}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={13} strokeWidth={1.7} className="text-muted" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectScrollUpButton = forwardRef<
  ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className = "", ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={`flex cursor-default items-center justify-center py-1 text-muted ${className}`.trim()}
    {...props}
  >
    <ChevronUp size={13} strokeWidth={1.7} />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

export const SelectScrollDownButton = forwardRef<
  ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className = "", ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={`flex cursor-default items-center justify-center py-1 text-muted ${className}`.trim()}
    {...props}
  >
    <ChevronDown size={13} strokeWidth={1.7} />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className = "", children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={`relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-hidden rounded-md border border-line bg-panel text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ${position === "popper" ? "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1" : ""} ${className}`.trim()}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={`p-1 ${position === "popper" ? "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]" : ""}`.trim()}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className = "", ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={`px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-subtle ${className}`.trim()}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className = "", children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={`relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-7 pr-2 text-[12.5px] text-text outline-none data-[highlighted]:bg-line-soft data-[state=checked]:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${className}`.trim()}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={12} strokeWidth={2} className="text-accent" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className = "", ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={`-mx-1 my-1 h-px bg-line-soft ${className}`.trim()}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
