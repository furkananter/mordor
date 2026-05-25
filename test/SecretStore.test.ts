import { describe, expect, it } from "vitest";
import { keychainServiceName } from "../src/main/SecretStore";
import { secretKeyForProfile } from "../src/core/config/profile";

describe("keychain naming", () => {
  it("uses the Mordor service and per-profile password account", () => {
    // Important: changing the service name is a breaking change — existing
    // installs would lose access to passwords stored under the previous name.
    // If we ever rename again, we need to add a migration that reads from the
    // old name and rewrites under the new one before deleting.
    expect(keychainServiceName).toBe("mordor");
    expect(secretKeyForProfile("p1")).toBe("connection:p1:password");
  });
});
