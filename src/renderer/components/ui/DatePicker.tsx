import { Calendar as CalendarIcon, X } from "lucide-react";
import { formatHumanDate } from "../../lib/formatDate";
import { Button } from "./Button";
import { Calendar } from "./Calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  align = "start"
}: {
  value?: Date | undefined;
  onChange(date: Date | undefined): void;
  placeholder?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-ui border border-line bg-panel px-2 py-1 text-[12px] ${value ? "text-text" : "text-muted"}`}
          aria-label={placeholder}
        >
          <CalendarIcon size={12} strokeWidth={1.7} />
          <span>{value ? formatHumanDate(value) : placeholder}</span>
          {value ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onChange(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(undefined);
                }
              }}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-muted hover:bg-line-soft hover:text-text"
              aria-label="Clear date"
            >
              <X size={10} strokeWidth={1.8} />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="p-0">
        <Calendar mode="single" selected={value} onSelect={onChange} autoFocus />
      </PopoverContent>
    </Popover>
  );
}
