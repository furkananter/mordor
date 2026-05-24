import { describe, expect, it } from "vitest";
import { createDetectedDraft, isSameEndpoint } from "../src/core/cassandra/localDiscovery";
import { ConnectionProfile } from "../src/core/config/profile";

const profile: ConnectionProfile = {
  id: "local",
  name: "Local",
  type: "cassandra",
  contactPoints: ["127.0.0.1"],
  port: 9042,
  localDataCenter: "datacenter1",
  useTls: false
};

describe("local Cassandra discovery helpers", () => {
  it("matches existing profiles by host and port", () => {
    expect(isSameEndpoint(profile, { host: "127.0.0.1", port: 9042 })).toBe(true);
    expect(isSameEndpoint(profile, { host: "127.0.0.1", port: 9142 })).toBe(false);
  });

  it("creates a connection draft from system.local metadata", () => {
    const result = createDetectedDraft(
      { host: "127.0.0.1", port: 9042 },
      { cluster_name: "Test Cluster", data_center: "dc1", release_version: "5.0.0" }
    );

    expect(result).toEqual({
      clusterName: "Test Cluster",
      metadataRead: true,
      releaseVersion: "5.0.0",
      draft: {
        type: "cassandra",
        name: "Test Cluster (127.0.0.1:9042)",
        contactPoints: "127.0.0.1",
        port: "9042",
        localDataCenter: "dc1",
        useTls: false
      }
    });
  });
});
