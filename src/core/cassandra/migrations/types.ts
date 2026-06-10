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
  /** null when the source table has no checksum column → drift detection is skipped. */
  checksum: string | null;
  applied_at: Date | string | null;
  success: boolean;
  error_message: string | null;
}

export interface ApplyOutcome {
  success: boolean;
  error?: string;
  executed?: number;
  total?: number;
}

export const TRACKING_TABLE = "schema_migrations";
export const HISTORY_TABLE = "schema_migrations_log";
export const HISTORY_LIMIT = 30;

/** The columns Mordor's own `schema_migrations` table is created with. */
export const REQUIRED_TRACKING_COLUMNS = [
  "version",
  "filename",
  "checksum",
  "applied_at",
  "success",
  "error_message"
] as const;

export function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function formatApplied(value: AppliedRow["applied_at"]): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/** Coerce a tracking-table version cell (text, int, bigint Long, …) to a string. */
export function versionToString(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

/**
 * "001" and "1" name the same migration. Tools store versions as zero-padded
 * text or as integers, so we match on the raw value *and* a leading-zero-stripped
 * numeric form, letting a file's version line up with whatever the table holds.
 */
export function versionKeyVariants(version: string): string[] {
  const variants = [version];
  if (/^\d+$/.test(version)) {
    const numeric = String(Number(version));
    if (numeric !== version) variants.push(numeric);
  }
  return variants;
}
