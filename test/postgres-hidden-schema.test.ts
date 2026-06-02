import { describe, expect, it } from "vitest";
import { isHiddenSchemaName } from "../src/core/postgres/PostgresService";

describe("isHiddenSchemaName", () => {
  it("hides every TimescaleDB internal schema (prefix match)", () => {
    expect(isHiddenSchemaName("_timescaledb_catalog")).toBe(true);
    expect(isHiddenSchemaName("_timescaledb_internal")).toBe(true);
    expect(isHiddenSchemaName("_timescaledb_config")).toBe(true);
    expect(isHiddenSchemaName("_timescaledb_cache")).toBe(true);
    expect(isHiddenSchemaName("_timescaledb_functions")).toBe(true);
    // future TimescaleDB versions that add new internal namespaces should
    // continue to be hidden without a code change.
    expect(isHiddenSchemaName("_timescaledb_anything_new")).toBe(true);
  });

  it("hides known Supabase / pg_partman bookkeeping schemas", () => {
    expect(isHiddenSchemaName("_realtime")).toBe(true);
    expect(isHiddenSchemaName("supabase_functions")).toBe(true);
    expect(isHiddenSchemaName("pgsodium")).toBe(true);
    expect(isHiddenSchemaName("graphql")).toBe(true);
    expect(isHiddenSchemaName("vault")).toBe(true);
    expect(isHiddenSchemaName("partman")).toBe(true);
  });

  it("does NOT hide user schemas — even ones that share a prefix with a real schema name", () => {
    expect(isHiddenSchemaName("public")).toBe(false);
    expect(isHiddenSchemaName("app")).toBe(false);
    // `_timescaledb` (no trailing underscore) is not a real TimescaleDB
    // namespace — a user that names a schema this way should still see it.
    expect(isHiddenSchemaName("_timescaledb")).toBe(false);
    // Schemas that happen to start with `supabase` but aren't the bookkeeping
    // ones we know about stay visible.
    expect(isHiddenSchemaName("supabase")).toBe(false);
    expect(isHiddenSchemaName("supabase_app")).toBe(false);
  });
});
