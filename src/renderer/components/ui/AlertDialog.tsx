import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { ComponentPropsWithoutRef, ElementRef, HTMLAttributes, forwardRef } from "react";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

const overlayClass = "fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]";
const contentClass =
  "fixed left-1/2 top-1/2 z-50 grid w-full max-w-[440px] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border border-line bg-panel p-5 text-text shadow-[0_8px_24px_rgba(0,0,0,0.08)] outline-none";

export const AlertDialogOverlay = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className = "", ...props }, ref) => (
  <AlertDialogPrimitive.Overlay ref={ref} className={`${overlayClass} ${className}`.trim()} {...props} />
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";

export const AlertDialogContent = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & { size?: "default" | "sm" }
>(({ className = "", size = "default", ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={`${contentClass} ${size === "sm" ? "max-w-[340px] p-4" : ""} ${className}`.trim()}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = "AlertDialogContent";

export function AlertDialogHeader({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`grid gap-1 ${className}`.trim()} {...props} />;
}

export function AlertDialogFooter({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`mt-2 flex justify-end gap-1 ${className}`.trim()} {...props} />;
}

export const AlertDialogTitle = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className = "", ...props }, ref) => (
  <AlertDialogPrimitive.Title ref={ref} className={`text-[15px] font-semibold text-text ${className}`.trim()} {...props} />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className = "", ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={`text-[12.5px] leading-[1.55] text-muted ${className}`.trim()}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

const actionBase =
  "no-drag inline-flex select-none items-center justify-center gap-1.5 rounded-ui px-2.5 py-1.5 text-[12px] font-medium leading-none transition-colors duration-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed";

export const AlertDialogAction = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Action>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & { variant?: "primary" | "danger" }
>(({ className = "", variant = "primary", ...props }, ref) => {
  const variantClass =
    variant === "danger"
      ? "bg-danger text-white hover:bg-danger/90"
      : "bg-accent text-white hover:bg-accent/90";
  return (
    <AlertDialogPrimitive.Action ref={ref} className={`${actionBase} ${variantClass} ${className}`.trim()} {...props} />
  );
});
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = forwardRef<
  ElementRef<typeof AlertDialogPrimitive.Cancel>,
  ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className = "", ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={`${actionBase} text-text/85 hover:bg-line-soft hover:text-text ${className}`.trim()}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";
