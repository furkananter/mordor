import { describe, expect, it } from "vitest";
import { keychainServiceName } from "../src/main/SecretStore";
import { secretKeyForProfile } from "../src/core/config/profile";

describe("keychain naming", () => {
  it("uses the Mordor service and per-profile password account", () => {
    // Renaming the service breaks existing installs — they'd lose access to
    // passwords saved under the previous name. Any future rename needs a
    // migration that reads the old service and writes to the new one before
    // the old entry is removed.
    expect(keychainServiceName).toBe("mordor");
    expect(secretKeyForProfile("p1")).toBe("connection:p1:password");
  });
});
