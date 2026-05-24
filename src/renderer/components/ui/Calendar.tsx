import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import type { ComponentProps } from "react";
import "react-day-picker/style.css";

export type CalendarProps = ComponentProps<typeof DayPicker>;

export function Calendar({ className = "", classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={`rdp p-3 text-text ${className}`.trim()}
      classNames={{
        months: "flex flex-col gap-3",
        month: "space-y-3",
        month_caption: "flex items-center justify-center pt-1 text-[12.5px] font-medium",
        caption_label: "text-[12.5px] font-medium text-text",
        nav: "absolute right-3 top-3 flex items-center gap-1",
        button_previous: "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-line-soft hover:text-text",
        button_next: "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-line-soft hover:text-text",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 text-[10.5px] font-medium uppercase tracking-[0.06em] text-subtle",
        week: "flex w-full",
        day: "h-8 w-8 p-0 text-center text-[12px]",
        day_button: "inline-flex h-8 w-8 items-center justify-center rounded-md text-text hover:bg-line-soft focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30",
        selected: "[&_button]:bg-accent [&_button]:text-white [&_button]:hover:bg-accent",
        today: "[&_button]:font-semibold [&_button]:text-accent",
        outside: "[&_button]:text-subtle",
        disabled: "[&_button]:text-subtle [&_button]:opacity-40",
        range_start: "[&_button]:rounded-r-none",
        range_middle: "[&_button]:rounded-none [&_button]:bg-accent-soft [&_button]:text-accent",
        range_end: "[&_button]:rounded-l-none",
        ...classNames
      }}
      components={{
        Chevron: ({ orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon size={14} strokeWidth={1.7} />;
        }
      }}
      {...props}
    />
  );
}
