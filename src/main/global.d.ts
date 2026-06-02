export {};

declare global {
  /**
   * Baked in at build time by esbuild's `define` (scripts/build-main.mjs):
   * `true` when this build was signed with a Developer ID certificate
   * (CSC_LINK present at build time). The macOS updater uses it to decide
   * between the seamless Squirrel.Mac flow (signed) and the manual
   * DMG-download fallback (ad-hoc). Defaults to `false` in tests.
   */
  const __MAC_SIGNED__: boolean;
}
