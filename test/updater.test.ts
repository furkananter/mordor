import { describe, expect, it } from "vitest";
import {
  isNewerSemver,
  parseSha256,
  pickMacAsset,
  type RawGithubAsset,
} from "../src/main/UpdaterService";

describe("isNewerSemver", () => {
  it("compares the major.minor.patch triple", () => {
    expect(isNewerSemver("0.5.6", "0.5.5")).toBe(true);
    expect(isNewerSemver("0.6.0", "0.5.9")).toBe(true);
    expect(isNewerSemver("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerSemver("0.5.5", "0.5.5")).toBe(false);
    expect(isNewerSemver("0.5.4", "0.5.5")).toBe(false);
  });

  it("tolerates a leading v and missing segments", () => {
    expect(isNewerSemver("0.5", "0.4.9")).toBe(true);
    expect(isNewerSemver("0.5.0", "0.5")).toBe(false);
  });

  it("treats a final release as newer than its pre-release", () => {
    expect(isNewerSemver("0.5.6", "0.5.6-rc.1")).toBe(true);
    expect(isNewerSemver("0.5.6-rc.1", "0.5.6")).toBe(false);
    expect(isNewerSemver("0.5.6-rc.2", "0.5.6-rc.1")).toBe(true);
  });
});

describe("parseSha256", () => {
  it("extracts the hex from a sha256 digest", () => {
    const hex = "a".repeat(64);
    expect(parseSha256(`sha256:${hex}`)).toBe(hex);
    expect(parseSha256(`SHA256:${"A".repeat(64)}`)).toBe("a".repeat(64));
  });

  it("returns undefined for missing or non-sha256 digests", () => {
    expect(parseSha256(undefined)).toBeUndefined();
    expect(parseSha256(null)).toBeUndefined();
    expect(parseSha256("")).toBeUndefined();
    expect(parseSha256("md5:abcdef")).toBeUndefined();
    expect(parseSha256("sha256:tooshort")).toBeUndefined();
  });
});

// Mirrors the real v0.5.6 release: per-arch DMGs + zips + blockmaps + manifests.
const releaseAssets: RawGithubAsset[] = [
  { name: "latest-mac.yml", browser_download_url: "https://gh/latest-mac.yml", size: 794 },
  {
    name: "Mordor-0.5.6-arm64.dmg",
    browser_download_url: "https://gh/Mordor-0.5.6-arm64.dmg",
    size: 133664206,
    digest: "sha256:" + "1".repeat(64),
  },
  {
    name: "Mordor-0.5.6-arm64.dmg.blockmap",
    browser_download_url: "https://gh/Mordor-0.5.6-arm64.dmg.blockmap",
    size: 140138,
  },
  {
    name: "Mordor-0.5.6.dmg",
    browser_download_url: "https://gh/Mordor-0.5.6.dmg",
    size: 140657460,
    digest: "sha256:" + "2".repeat(64),
  },
  { name: "Mordor-0.5.6-arm64-mac.zip", browser_download_url: "https://gh/arm64.zip", size: 128631867 },
];

describe("pickMacAsset", () => {
  it("picks the arm64 dmg on Apple Silicon", () => {
    const asset = pickMacAsset(releaseAssets, "arm64");
    expect(asset?.name).toBe("Mordor-0.5.6-arm64.dmg");
    expect(asset?.url).toBe("https://gh/Mordor-0.5.6-arm64.dmg");
    expect(asset?.size).toBe(133664206);
    expect(asset?.sha256).toBe("1".repeat(64));
  });

  it("picks the intel dmg on x64", () => {
    const asset = pickMacAsset(releaseAssets, "x64");
    expect(asset?.name).toBe("Mordor-0.5.6.dmg");
    expect(asset?.sha256).toBe("2".repeat(64));
  });

  it("never picks a blockmap or zip", () => {
    const asset = pickMacAsset(releaseAssets, "arm64");
    expect(asset?.name.endsWith(".dmg")).toBe(true);
    expect(asset?.name).not.toContain(".blockmap");
  });

  it("lets arm64 fall back to the intel dmg (runs under Rosetta)", () => {
    const intelOnly = releaseAssets.filter((a) => a.name === "Mordor-0.5.6.dmg");
    expect(pickMacAsset(intelOnly, "arm64")?.name).toBe("Mordor-0.5.6.dmg");
  });

  it("does not give an intel host an arm64-only dmg", () => {
    const armOnly = releaseAssets.filter((a) => a.name === "Mordor-0.5.6-arm64.dmg");
    expect(pickMacAsset(armOnly, "x64")).toBeUndefined();
  });

  it("returns undefined when no dmg is published", () => {
    const noDmg = releaseAssets.filter((a) => !a.name!.endsWith(".dmg"));
    expect(pickMacAsset(noDmg, "arm64")).toBeUndefined();
    expect(pickMacAsset([], "arm64")).toBeUndefined();
  });

  it("omits sha256 when the asset has no digest", () => {
    const noDigest: RawGithubAsset[] = [
      { name: "Mordor-9.9.9-arm64.dmg", browser_download_url: "https://gh/x.dmg", size: 10 },
    ];
    expect(pickMacAsset(noDigest, "arm64")?.sha256).toBeUndefined();
  });
});
