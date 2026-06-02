import esbuild from "esbuild";

const isWatchMode = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: isWatchMode,
  minify: !isWatchMode,
  // Preserve class + function names through minification. Without this,
  // esbuild renames classes like cassandra-driver's `Uuid` to single letters,
  // which breaks any runtime code that checks `value.constructor.name`
  // (we hit this with Cassandra wrapper types and UUID columns rendered as
  // `{"buffer":"0x..."}`). The bundle size cost is < 2 KB.
  keepNames: !isWatchMode,
  external: ["electron", "keytar", "node-pty"],
  // Bake whether this build is Developer-ID signed into the main bundle. CI's
  // release job exposes CSC_LINK (the signing cert) to this build step, so its
  // presence is a reliable signal that electron-builder will sign + notarize.
  // The macOS updater reads this to pick the seamless Squirrel flow vs. the
  // ad-hoc DMG-download fallback. Empty/unset (local dev, unsigned CI) => false.
  define: {
    __MAC_SIGNED__: JSON.stringify(Boolean(process.env.CSC_LINK)),
  },
  logLevel: "info"
};

async function buildMain() {
  if (isWatchMode) {
    const context = await esbuild.context({
      ...shared,
      entryPoints: ["src/main/index.ts"],
      outfile: "dist/main/index.cjs"
    });
    await context.watch();
    return;
  }

  await esbuild.build({
    ...shared,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main/index.cjs"
  });
}

async function buildPreload() {
  if (isWatchMode) {
    const context = await esbuild.context({
      ...shared,
      entryPoints: ["src/preload/index.ts"],
      outfile: "dist/preload/index.cjs"
    });
    await context.watch();
    return;
  }

  await esbuild.build({
    ...shared,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload/index.cjs"
  });
}

if (isWatchMode) {
  await Promise.all([buildMain(), buildPreload()]);
  await new Promise(() => {});
} else {
  await Promise.all([buildMain(), buildPreload()]);
}
