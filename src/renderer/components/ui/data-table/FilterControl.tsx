import { Column } from "@tanstack/react-table";
import { DatePicker } from "../DatePicker";
import { Input } from "../Input";
import { ColumnMeta, Row } from "./types";

export function FilterControl({ column }: { column: Column<Row, unknown> }) {
  const meta = column.columnDef.meta as ColumnMeta | undefined;
  const value = column.getFilterValue();

  if (meta?.filterKind === "date") {
    return (
      <DatePicker
        value={value instanceof Date ? value : undefined}
        onChange={(date) => column.setFilterValue(date)}
        placeholder="Any date"
      />
    );
  }

  return (
    <Input
      value={typeof value === "string" ? value : ""}
      onChange={(event) => column.setFilterValue(event.target.value)}
      placeholder="Filter..."
      onClick={(event) => event.stopPropagation()}
    />
  );
}
