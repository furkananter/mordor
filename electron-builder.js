// @ts-check
/**
 * electron-builder configuration.
 *
 * Moved out of package.json's "build" key so macOS code signing + notarization
 * can be toggled by environment. A release built with the Apple secrets present
 * is Developer-ID-signed and notarized, which unlocks seamless in-app
 * auto-update on macOS (Squirrel.Mac). Builds without those secrets — a local
 * `npm run dist:mac`, or CI before the secrets are added — fall back to an
 * ad-hoc signature so the app still launches; on those, the macOS updater uses
 * the manual DMG-download path instead (see src/main/UpdaterService.ts).
 *
 * Required GitHub Actions secrets for signed releases (see
 * docs/RELEASE_SIGNING.md for how to obtain each):
 *
 *   MAC_CSC_LINK                 base64 of the Developer ID Application .p12
 *   MAC_CSC_KEY_PASSWORD         password protecting that .p12
 *   APPLE_ID                     Apple ID email used for notarization
 *   APPLE_APP_SPECIFIC_PASSWORD  app-specific password for that Apple ID
 *   APPLE_TEAM_ID                10-character Apple Developer Team ID
 *
 * The release workflow maps MAC_CSC_LINK/MAC_CSC_KEY_PASSWORD onto the
 * CSC_LINK/CSC_KEY_PASSWORD env vars electron-builder reads.
 */

// Signing turns on only when a certificate is provided via CSC_LINK; otherwise
// we stay ad-hoc so the build still runs locally.
const signMac = Boolean(process.env.CSC_LINK);

// Notarization additionally needs Apple credentials. Without them we sign but
// skip notarization rather than fail the build.
const notarizeMac =
  signMac &&
  Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID,
  );

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "com.mordor.db",
  productName: "Mordor",
  executableName: "Mordor",
  directories: {
    output: "release",
  },
  asar: true,
  files: ["dist/**", "package.json"],
  extraResources: [
    {
      from: "media",
      to: "media",
    },
  ],
  publish: [
    {
      provider: "github",
      owner: "furkananter",
      repo: "mordor",
      releaseType: "release",
    },
  ],
  mac: {
    icon: "media/macos/AppIcon.icns",
    target: ["dmg", "zip"],
    // With a real certificate, leave `identity` unset so electron-builder
    // auto-selects the Developer ID Application identity it imported from
    // CSC_LINK. Without one, force ad-hoc (`-`) so the app still launches.
    ...(signMac ? {} : { identity: "-" }),
    // Hardened runtime is mandatory for notarization; only enable it when we're
    // actually signing (an ad-hoc build with hardened runtime fails to launch).
    hardenedRuntime: signMac,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    notarize: notarizeMac,
  },
  win: {
    icon: "media/macos/AppIcon512.png",
    target: ["nsis"],
  },
  linux: {
    icon: "media/macos/AppIcon512.png",
    target: ["AppImage"],
    category: "Development",
  },
};

module.exports = config;
