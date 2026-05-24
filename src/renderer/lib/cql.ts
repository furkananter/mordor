import { TableIdentity } from "../../core/shared/messages";

export function defaultQueryForTable(table: TableIdentity): string {
  return `SELECT * FROM "${quoteIdentifier(table.keyspace)}"."${quoteIdentifier(table.table)}" LIMIT 1000;`;
}

function quoteIdentifier(identifier: string): string {
  return identifier.replace(/"/g, '""');
}
