import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let warnedUnavailable = false;

/**
 * @param {string} [overridePath]
 */
export function resolveStateVscdbPath(overridePath = process.env.CURSOR_STATE_VSCDB_PATH) {
  if (overridePath) {
    return overridePath;
  }

  const home = homedir();
  const plat = platform();

  if (plat === "darwin") {
    return join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (plat === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

/**
 * @param {string} dbPath
 */
export function readCursorAccessToken(dbPath = resolveStateVscdbPath()) {
  if (!existsSync(dbPath)) {
    warnUnavailable(`Cursor state database not found at ${dbPath}`);
    return null;
  }

  const fromNodeSqlite = readTokenWithNodeSqlite(dbPath);
  if (fromNodeSqlite) {
    return fromNodeSqlite;
  }

  const fromCli = readTokenWithSqliteCli(dbPath);
  if (fromCli) {
    return fromCli;
  }

  warnUnavailable("Dashboard billing requires Node 22.5+ (node:sqlite) or sqlite3 CLI on PATH");
  return null;
}

/**
 * @param {string} dbPath
 */
function readTokenWithNodeSqlite(dbPath) {
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("cursorAuth/accessToken");
    db.close();
    const value = row?.value;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} dbPath
 */
function readTokenWithSqliteCli(dbPath) {
  const result = spawnSync("sqlite3", [dbPath, "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken';"], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    return null;
  }
  const token = result.stdout?.trim();
  return token ? token : null;
}

/** @param {string} token */
export function buildDashboardSessionCookie(token) {
  return `WorkosCursorSessionToken=${token}`;
}

/** @param {string} message */
function warnUnavailable(message) {
  if (warnedUnavailable) {
    return;
  }
  warnedUnavailable = true;
  console.warn(`cursorscope: ${message}`);
}

/** Test hook */
export function _resetDashboardAuthWarnings() {
  warnedUnavailable = false;
}
