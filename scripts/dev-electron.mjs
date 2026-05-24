import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const minPort = 5273;
const maxPort = 5273;
const scanDelayMs = 400;
const scanAttempts = 80;

async function isRendererReady(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok || response.status >= 300 && response.status < 400;
  } catch {
    return false;
  }
}

async function findRendererUrl() {
  for (let attempt = 0; attempt < scanAttempts; attempt += 1) {
    for (let port = minPort; port <= maxPort; port += 1) {
      const url = `http://localhost:${port}`;
      if (await isRendererReady(url)) {
        return url;
      }
    }
    await sleep(scanDelayMs);
  }
  return undefined;
}

const rendererUrl = await findRendererUrl();
if (!rendererUrl) {
  throw new Error(`Renderer URL not found on localhost ports ${minPort}-${maxPort}. Start vite first.`);
}

console.log(`Renderer found at ${rendererUrl}`);
const executable = process.platform === "win32" ? "electronmon.cmd" : "electronmon";
const electronProcess = spawn(
  executable,
  ["."],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      RENDERER_URL: rendererUrl
    }
  }
);

electronProcess.on("exit", (code) => {
  process.exit(code ?? 0);
});
