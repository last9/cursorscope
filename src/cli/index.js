import { homedir } from "node:os";
import path from "node:path";
import { runSetup } from "./setup.js";
import { runStart, runStatus, runStop } from "./daemon.js";
import { runInstallHooks, runUninstallHooks } from "./hooks.js";

const DEFAULT_HOME = path.join(homedir(), ".cursorscope");

function printHelp() {
  console.log(`cursorscope — export Cursor hook events to OpenTelemetry

Usage:
  cursorscope setup [--last9] [--home DIR] [--force] [--no-hooks] [--dry-run] [--yes]
  cursorscope start [--home DIR]
  cursorscope stop
  cursorscope status [--home DIR]
  cursorscope hooks install [--home DIR]
  cursorscope hooks uninstall

Options:
  --last9       Last9 OTLP preset; prompts for URL + token (admin-only in Last9)
  --home DIR    Install location (default: ~/.cursorscope)
  --force       Re-copy package files into --home
  --no-hooks    Skip ~/.cursor/hooks.json merge (project hooks only)
  --dry-run     Print planned .env; skip npm, hooks, and ingestor start
  --yes         Skip prompts (use defaults / env flags below)
  --otlp-base   Last9 OTLP base URL (non-interactive)
  --auth-token  Last9 OTLP token or user:password (non-interactive)
  --no-browser  Do not offer to open Last9 OpenTelemetry integration page

Examples:
  npx @last9/cursorscope
  cursorscope setup && cursorscope start
`);
}

/** @param {string[]} argv */
export async function runCli(argv) {
  if (!argv.length) {
    return runCli(["setup", "--last9"]);
  }
  if (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    printHelp();
    return 0;
  }

  const [command, ...tail] = argv;
  const hookSubcommand = command === "hooks" ? tail[0] : undefined;
  const optionArgs = command === "hooks" ? tail.slice(1) : tail;
  const options = parseOptions(optionArgs);

  try {
    switch (command) {
      case "setup":
        return await runSetup(options);
      case "start":
        return runStart(options);
      case "stop":
        return runStop();
      case "status":
        return runStatus(options);
      case "hooks":
        if (hookSubcommand === "uninstall") {
          return runUninstallHooks();
        }
        return runInstallHooks(options);
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        return 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** @param {string[]} args */
function parseOptions(args) {
  /** @type {{ home: string, last9: boolean, force: boolean, noHooks: boolean, dryRun: boolean, yes: boolean, noBrowser: boolean, otlpBase?: string, authToken?: string }} */
  const options = {
    home: DEFAULT_HOME,
    last9: false,
    force: false,
    noHooks: false,
    dryRun: false,
    yes: false,
    noBrowser: false,
    otlpBase: undefined,
    authToken: undefined
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--last9") {
      options.last9 = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--no-hooks") {
      options.noHooks = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--no-browser") {
      options.noBrowser = true;
    } else if (arg === "--home") {
      options.home = args[++i];
      if (!options.home) {
        throw new Error("--home requires a path");
      }
    } else if (arg.startsWith("--home=")) {
      options.home = arg.slice("--home=".length);
    } else if (arg === "--otlp-base") {
      options.otlpBase = args[++i];
    } else if (arg.startsWith("--otlp-base=")) {
      options.otlpBase = arg.slice("--otlp-base=".length);
    } else if (arg === "--auth-token") {
      options.authToken = args[++i];
    } else if (arg.startsWith("--auth-token=")) {
      options.authToken = arg.slice("--auth-token=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}
