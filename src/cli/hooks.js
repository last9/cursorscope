import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveHome } from "./paths.js";

/** @param {{ home?: string }} [options] */
export function runInstallHooks(options = {}) {
  const home = resolveHome(options.home || defaultHome());
  const script = path.join(home, "scripts/install-global-hooks.sh");
  const result = spawnSync("bash", [script], {
    stdio: "inherit",
    env: { ...process.env, CURSORSCOPE_HOME: home }
  });
  if (result.status === 0) {
    console.log(`Global hooks installed (CURSORSCOPE_HOME=${home})`);
  }
  return result.status ?? 1;
}

export function runUninstallHooks() {
  const home = defaultHome();
  const script = path.join(home, "scripts/uninstall-global-hooks.sh");
  const result = spawnSync("bash", [script], {
    stdio: "inherit",
    env: { ...process.env, CURSORSCOPE_HOME: home }
  });
  return result.status ?? 1;
}

function defaultHome() {
  return resolveHome("~/.cursorscope");
}
