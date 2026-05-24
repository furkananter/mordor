export interface MigrationEntry {
  version: string;
  name: string;
  filename: string;
  checksum: string;
  contents: string;
}

export interface AppliedRow {
  version: string;
  filename: string;
  checksum: string;
  applied_at: Date | { toString(): string };
  success: boolean;
  error_message: string | null;
}

export const TRACKING_TABLE = "schema_migrations";
export const HISTORY_TABLE = "schema_migrations_log";
export const HISTORY_LIMIT = 30;

export function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function formatApplied(value: AppliedRow["applied_at"]): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}
