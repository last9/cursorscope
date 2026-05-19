import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getPackageRoot, resolveHome } from "./paths.js";
import { runInstallHooks } from "./hooks.js";
import { runStart } from "./daemon.js";
import { buildLast9Env } from "./env-templates.js";
import { isInteractive, promptLast9Config } from "./prompt.js";

const COPY_SKIP = new Set(["node_modules", ".git", ".github", ".env", "test"]);

/**
 * @param {{
 *   home: string,
 *   last9: boolean,
 *   force: boolean,
 *   noHooks: boolean,
 *   dryRun: boolean,
 *   yes: boolean,
 *   noBrowser: boolean,
 *   otlpBase?: string,
 *   authToken?: string,
 * }} options
 */
export async function runSetup(options) {
  const home = resolveHome(options.home);
  const packageRoot = getPackageRoot();

  if (options.dryRun) {
    console.log("Dry run — no hooks, ingestor start, or global config changes.");
  }

  if (options.force && existsSync(home)) {
    if (options.dryRun) {
      console.log(`Would refresh install at ${home}`);
    } else {
      cpSync(home, `${home}.bak.${Date.now()}`, { recursive: true });
    }
  }

  mkdirSync(home, { recursive: true });
  if (path.resolve(home) !== path.resolve(packageRoot)) {
    if (options.dryRun) {
      console.log(`Would copy package → ${home}`);
    } else {
      copyPackageTree(packageRoot, home);
    }
  } else {
    console.log(`Using in-place install at ${home}`);
  }

  if (!options.dryRun) {
    const npmResult = spawnSync("npm", ["install", "--omit=dev"], {
      cwd: home,
      stdio: "inherit",
      env: process.env
    });
    if (npmResult.status !== 0) {
      throw new Error("npm install failed");
    }
  } else {
    console.log("Would run: npm install --omit=dev");
  }

  const envPath = path.join(home, ".env");
  const last9Config = options.last9
    ? await promptLast9Config({
        interactive: !options.yes && isInteractive(),
        otlpBase: options.otlpBase,
        authToken: options.authToken,
        openBrowser: !options.noBrowser
      })
    : null;

  if (!existsSync(envPath) || options.force) {
    const envBody = buildEnvFile(options.last9, home, last9Config);
    if (options.dryRun) {
      console.log(`Would write ${envPath}:`);
      console.log("---");
      console.log(envBody.trimEnd());
      console.log("---");
    } else {
      writeFileSync(envPath, envBody, "utf8");
      console.log(`Wrote ${envPath}`);
    }
  } else {
    const version = readPackageVersion(home);
    const port = process.env.PORT || "4327";
    patchEnvFile(envPath, {
      PORT: port,
      CURSOR_HOOK_ENDPOINT: `http://localhost:${port}/cursor/hooks`,
      CURSORSCOPE_HOME: home,
      OTEL_SERVICE_VERSION: version
    });
    console.log(`Updated infrastructure keys in ${envPath} (credentials preserved)`);
  }

  if (!options.noHooks && !options.dryRun) {
    const hookExit = runInstallHooks({ home });
    if (hookExit !== 0) {
      throw new Error("Failed to install global Cursor hooks");
    }
  } else if (!options.noHooks && options.dryRun) {
    console.log("Would install global Cursor hooks");
  }

  console.log("");
  console.log("cursorscope is installed.");
  console.log(`  Home:    ${home}`);
  console.log(`  Logs:    ~/.cursor/cursorscope.log`);
  console.log(`  Health:  http://127.0.0.1:4327/healthz`);
  console.log("");

  const needsAuth =
    options.last9 &&
    (!last9Config?.otlpHeaders ||
      last9Config.otlpHeaders.includes("REPLACE_WITH_LAST9_OTLP_TOKEN"));

  if (needsAuth) {
    console.log(
      "Next: set OTEL_EXPORTER_OTLP_HEADERS in .env (ask your Last9 admin for the token if needed)."
    );
  } else if (options.last9) {
    console.log("Last9 OTLP credentials saved in .env.");
  } else {
    console.log("Next: edit .env with your OTLP endpoint and credentials.");
  }
  console.log("Then restart Cursor and use Agent chat once.");
  console.log("");

  if (!options.dryRun) {
    const startExit = runStart({ home });
    if (startExit === 0) {
      console.log("Ingestor started (or already running).");
    }
  } else {
    console.log("Dry run complete.");
  }

  return 0;
}

/** @param {string} src @param {string} dest */
function copyPackageTree(src, dest) {
  cpSync(src, dest, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(src, source);
      if (!rel) {
        return true;
      }
      const top = rel.split(path.sep)[0];
      return !COPY_SKIP.has(top);
    }
  });
}

/**
 * @param {boolean} last9
 * @param {string} home
 * @param {import("./prompt.js").Last9Config | null} last9Config
 */
function buildEnvFile(last9, home, last9Config) {
  const version = readPackageVersion(home);
  if (last9 && last9Config) {
    return buildLast9Env(home, version, {
      otlpBase: last9Config.otlpBase,
      otlpHeaders: last9Config.otlpHeaders
    });
  }
  if (last9) {
    return buildLast9Env(home, version);
  }
  const examplePath = path.join(getPackageRoot(), ".env.example");
  if (existsSync(examplePath)) {
    return readFileSync(examplePath, "utf8");
  }
  return buildLast9Env(home, version).replace(/otlp-aps1\.last9\.io/g, "localhost:4318");
}

/**
 * Patch specific keys in an existing .env file without touching other values.
 * @param {string} envPath
 * @param {Record<string, string>} updates
 */
function patchEnvFile(envPath, updates) {
  let content = readFileSync(envPath, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(content)) {
      content = content.replace(pattern, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}\n`;
    }
  }
  writeFileSync(envPath, content, "utf8");
}

/** @param {string} home */
function readPackageVersion(home) {
  for (const root of [home, getPackageRoot()]) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
      if (pkg.version) {
        return pkg.version;
      }
    } catch {
      // try next root
    }
  }
  return "0.0.0";
}
