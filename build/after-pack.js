// @ts-check
const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * electron-builder `afterPack` hook — Linux launcher shim.
 *
 * Electron's setuid `chrome-sandbox` needs a root-owned, mode-4755 binary. An
 * AppImage runs from a FUSE mount that can't carry that bit, so on kernels
 * that don't hand out an unprivileged user namespace — Debian/Arch (no
 * `kernel.unprivileged_userns_clone`) and Ubuntu 24.04+ (AppArmor's
 * `apparmor_restrict_unprivileged_userns`) — the sandbox host FATAL-aborts at
 * startup. We already accept running without the OS sandbox on Linux (the
 * renderer stays isolated via contextIsolation + no nodeIntegration), the same
 * trade-off DBeaver/Beekeeper take for their AppImages.
 *
 * The catch: passing `--no-sandbox` from app code (`appendSwitch`) lands too
 * late, and electron-builder's `executableArgs` only patches the `.desktop`
 * `Exec=` line — so it covers menu launches but NOT a direct
 * `./App.AppImage` run from a terminal, which is the common way to try it.
 *
 * The fix that covers every launch path is to wrap the product binary: rename
 * the real executable to `<name>.bin` and drop a tiny bash launcher in its
 * place that re-execs the real binary with `--no-sandbox`. Because both the
 * AppImage `AppRun` and the `.desktop` entry ultimately run the product
 * binary, the flag is guaranteed to be on the real argv before Electron
 * initialises. Mirrors the approach of `electron-builder-sandbox-fix`, kept
 * in-tree so the release pipeline carries no extra dependency.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") return;

  const executableName = context.packager.executableName;
  const productName = context.packager.appInfo.productName;
  const target = path.join(context.appOutDir, executableName);

  // Unconditional --no-sandbox matches the app's existing Linux stance
  // (src/main/index.ts appends the same switch for all linux launches).
  const launcher = `#!/usr/bin/env bash
set -u

dir="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
# When system-integrated the launcher sits in /usr/bin but the binary is in /opt.
if [ "$dir" = "/usr/bin" ]; then
  dir="/opt/${productName}"
fi

exec "$dir/${executableName}.bin" --no-sandbox "$@"
`;

  await fs.rename(target, `${target}.bin`);
  await fs.writeFile(target, launcher, { mode: 0o755 });
};
