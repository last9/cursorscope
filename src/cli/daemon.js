import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveHome } from "./paths.js";

/** @param {{ home?: string }} [options] */
export function runStart(options = {}) {
  const home = resolveHome(options.home || defaultHome());
  const script = path.join(home, "scripts/ensure-cursorscope.sh");
  const result = spawnSync("bash", [script], {
    stdio: "inherit",
    env: { ...process.env, CURSORSCOPE_HOME: home }
  });
  return result.status ?? 1;
}

export function runStop() {
  const home = defaultHome();
  const script = path.join(home, "scripts/stop-cursorscope.sh");
  if (!pathExists(script)) {
    console.error(`Not found: ${script}. Run: cursorscope setup`);
    return 1;
  }
  const result = spawnSync("bash", [script], {
    stdio: "inherit",
    env: { ...process.env, CURSORSCOPE_HOME: home }
  });
  return result.status ?? 1;
}

/** @param {{ home?: string }} [options] */
export function runStatus(options = {}) {
  const home = resolveHome(options.home || defaultHome());
  const port = process.env.PORT || "8787";
  const result = spawnSync(
    "curl",
    ["-sf", `http://127.0.0.1:${port}/healthz`],
    { encoding: "utf8" }
  );
  if (result.status === 0 && result.stdout) {
    console.log(result.stdout.trim());
    return 0;
  }
  console.error(`Ingestor not healthy at :${port} (home: ${home})`);
  return 1;
}

function defaultHome() {
  return resolveHome("~/.cursorscope");
}

/** @param {string} filePath */
function pathExists(filePath) {
  return !!filePath && existsSync(filePath);
}
