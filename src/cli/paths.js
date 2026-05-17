import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Directory containing the published npm package (repo root when developing). */
export function getPackageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/** @param {string} home */
export function resolveHome(home) {
  if (home === "~") {
    return homedir();
  }
  if (home.startsWith("~/")) {
    return path.join(homedir(), home.slice(2));
  }
  return path.resolve(home);
}
