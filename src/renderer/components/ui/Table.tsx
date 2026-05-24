import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes, forwardRef } from "react";

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className = "", ...props }, ref) => (
    <table
      ref={ref}
      className={`min-w-full caption-bottom border-collapse text-[12px] ${className}`.trim()}
      {...props}
    />
  )
);
Table.displayName = "Table";

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className = "", ...props }, ref) => (
    <thead ref={ref} className={`sticky top-0 z-[1] bg-panel ${className}`.trim()} {...props} />
  )
);
TableHeader.displayName = "TableHeader";

export const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className = "", ...props }, ref) => <tbody ref={ref} className={className} {...props} />
);
TableBody.displayName = "TableBody";

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className = "", ...props }, ref) => (
    <tr
      ref={ref}
      className={`border-b border-line-soft transition-colors hover:bg-line-soft/50 data-[state=selected]:bg-accent-soft/50 ${className}`.trim()}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className = "", ...props }, ref) => (
    <th
      ref={ref}
      className={`border-b border-line px-3 py-2 text-left align-middle font-medium text-muted ${className}`.trim()}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className = "", ...props }, ref) => (
    <td
      ref={ref}
      className={`max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap px-3 py-1.5 align-middle text-text ${className}`.trim()}
      {...props}
    />
  )
);
TableCell.displayName = "TableCell";
