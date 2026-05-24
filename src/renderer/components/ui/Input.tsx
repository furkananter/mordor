import { InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input
      ref={ref}
      className={`min-h-[28px] w-full rounded-ui border border-line bg-panel px-2.5 py-1 text-[12.5px] text-text placeholder:text-subtle focus-visible:border-accent focus-visible:outline-none ${className}`.trim()}
      {...props}
    />
  )
);
Input.displayName = "Input";
