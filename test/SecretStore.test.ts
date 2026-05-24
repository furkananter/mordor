import { describe, expect, it } from "vitest";
import { keychainServiceName } from "../src/main/SecretStore";
import { secretKeyForProfile } from "../src/core/config/profile";

describe("keychain naming", () => {
  it("uses the Cassandra Desk service and per-profile password account", () => {
    expect(keychainServiceName).toBe("cassandra-desk");
    expect(secretKeyForProfile("p1")).toBe("connection:p1:password");
  });
});
