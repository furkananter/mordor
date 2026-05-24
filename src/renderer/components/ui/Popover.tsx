import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from "react";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className = "", align = "center", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={`z-50 w-auto rounded-md border border-line bg-panel p-3 text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)] outline-none ${className}`.trim()}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
