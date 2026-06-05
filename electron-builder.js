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
    // node-pty keeps its native binaries in arch-named paths
    // (bin/darwin-arm64-146/node-pty.node AND prebuilds/darwin-arm64/pty.node).
    // When building the universal app, @electron/universal sees the arm64 copies
    // left over in BOTH the x64 and arm64 slices, finds them byte-identical, and
    // aborts ("Detected file ... the same in both x64 and arm64 builds and not
    // covered by the x64ArchFiles rule"). The real per-arch binaries live in
    // separate darwin-{x64,arm64} folders and node-pty picks the right one by
    // process.arch at runtime, so the duplicates are harmless — whitelist the
    // whole module so the lipo merge proceeds. keytar lipo-merges normally
    // (single path, genuinely different per arch) and needs no entry here.
    x64ArchFiles: "**/node-pty/**",
    // Entitlements only apply to a real Developer ID signature. Passing them on
    // the ad-hoc path makes electron-builder's codesign step fail with
    // "... not a file" (the entitlements get fed to an ad-hoc sign that can't
    // consume them), which is what broke the 0.5.8 mac release. Gate them behind
    // signMac so unsigned/local builds keep the plain ad-hoc signature that
    // worked through 0.5.5.
    ...(signMac
      ? {
          entitlements: "build/entitlements.mac.plist",
          entitlementsInherit: "build/entitlements.mac.plist",
        }
      : {}),
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
    // Ubuntu 24.04+ / Debian Trixie enforce AppArmor rules that block
    // unprivileged user namespaces, causing the setuid chrome-sandbox check to
    // FATAL-abort even when no-sandbox is set programmatically (the check runs
    // before app code executes). Baking --no-sandbox into the AppImage wrapper
    // script ensures the flag is present on the real argv before Electron
    // initialises, which is the only reliable fix for AppImage distribution.
    // The renderer is already isolated via contextIsolation + no nodeIntegration.
    executableArgs: ["--no-sandbox", "--disable-gpu-sandbox"],
  },
};

module.exports = config;
