import { describe, expect, it } from "vitest";
import { MigrationTracker } from "../src/core/cassandra/migrations/MigrationTracker";

/**
 * A minimal stand-in for the cassandra-driver client. `inspectTrackingTable`
 * only ever issues the system_schema.columns query, so we just return whatever
 * column rows the test wants for that lookup.
 */
function fakeClient(columnNames: string[]) {
  return {
    execute: async () => ({
      rows: columnNames.map((column_name) => ({ column_name }))
    })
  } as unknown as import("cassandra-driver").Client;
}

describe("MigrationTracker.inspectTrackingTable", () => {
  const tracker = new MigrationTracker();

  it("reports 'absent' when no schema_migrations table exists", async () => {
    const status = await tracker.inspectTrackingTable(fakeClient([]), "app_dev");
    expect(status).toBe("absent");
  });

  it("reports 'compatible' when all Mordor columns are present", async () => {
    const status = await tracker.inspectTrackingTable(
      fakeClient(["version", "filename", "checksum", "applied_at", "success", "error_message"]),
      "app_dev"
    );
    expect(status).toBe("compatible");
  });

  it("reports 'incompatible' for a foreign table missing the version column", async () => {
    // golang-migrate's schema_migrations is (version_bigint, dirty) — different shape.
    const status = await tracker.inspectTrackingTable(fakeClient(["dirty"]), "app_dev");
    expect(status).toBe("incompatible");
  });

  it("assertTrackingTableUsable throws a guided error for a foreign table", async () => {
    await expect(
      tracker.assertTrackingTableUsable(fakeClient(["installed_rank", "version", "checksum"]), "app_dev")
    ).rejects.toThrow(/another migration tool/i);
  });

  it("assertTrackingTableUsable stays silent when the table is ours", async () => {
    await expect(
      tracker.assertTrackingTableUsable(
        fakeClient(["version", "filename", "checksum", "applied_at", "success", "error_message"]),
        "app_dev"
      )
    ).resolves.toBeUndefined();
  });
});
