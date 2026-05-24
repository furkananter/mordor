export function serializeCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }

  if (typeof value === "object") {
    if (isCassandraScalar(value)) {
      return value.toString();
    }

    return JSON.stringify(serializeNested(value));
  }

  return String(value);
}

export function serializeRows(
  rows: readonly Record<string, unknown>[],
): Record<string, string>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, serializeCell(value)]),
    ),
  );
}

function serializeNested(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Set) {
    return Array.from(value).map((entry) => serializeNested(entry));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value, ([key, entry]) => [
        String(key),
        serializeNested(entry),
      ]),
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeNested(entry));
  }

  if (typeof value === "object") {
    if (isCassandraScalar(value)) {
      return value.toString();
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeNested(entry),
      ]),
    );
  }

  return value;
}

/**
 * Detects cassandra-driver's scalar wrapper types (Uuid, TimeUuid, Long,
 * Integer, BigDecimal, LocalDate, LocalTime, InetAddress) without relying on
 * `value.constructor.name` — which is unreliable in production builds where
 * esbuild's identifier minification rewrites class names. The symptom of that
 * bug was UUID columns rendering as `{"buffer":"0xdcc7a10a..."}` because the
 * scalar check fell through to the object-enumeration branch.
 *
 * We use two cheap, version-stable signals:
 *   - For UUID-family values: a `buffer` Buffer of exactly 16 bytes.
 *   - For everything else: an own `toString` that yields a meaningful string
 *     (i.e. not the default `"[object Object]"`).
 */
function isCassandraScalar(value: object): value is { toString(): string } {
  // Arrays have a meaningful toString ("a,1,2") that we explicitly don't want
  // to short-circuit on — they need to be JSON-stringified as `["a",1,2]`.
  // Same for Set/Map (handled separately above in serializeNested anyway).
  if (Array.isArray(value)) return false;
  if (value instanceof Set || value instanceof Map) return false;
  if (Buffer.isBuffer(value) || value instanceof Date) return false;

  // Uuid / TimeUuid carry their bytes in a 16-byte Buffer property.
  const buffer = (value as { buffer?: unknown }).buffer;
  if (Buffer.isBuffer(buffer) && buffer.length === 16) return true;

  const str = (value as { toString?: () => string }).toString?.();
  if (typeof str !== "string") return false;
  // Plain objects fall back to "[object Object]" / "[object Foo]"; any class
  // that defined a real toString (Long, LocalDate, etc.) returns a meaningful
  // value here.
  return str.length > 0 && !str.startsWith("[object ");
}
