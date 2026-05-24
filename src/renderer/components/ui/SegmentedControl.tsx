import { ReactNode } from "react";

type SegmentedValue = string;

export interface SegmentedOption<T extends SegmentedValue> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends SegmentedValue> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  namespace: string;
  ariaLabel: string;
  className?: string;
}

export function SegmentedControl<T extends SegmentedValue>({
  options,
  value,
  onChange,
  ariaLabel,
  className = ""
}: SegmentedControlProps<T>) {
  return (
    <div className={`inline-flex items-center gap-0 ${className}`} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={`relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-100 ${
              active
                ? "text-text after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-accent"
                : "text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
