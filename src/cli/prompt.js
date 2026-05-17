import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import { LAST9_OTEL_ADMIN_NOTE, LAST9_OTEL_INTEGRATION_URL } from "./last9.js";

/** @returns {boolean} */
export function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY && !process.env.CI);
}

/**
 * @param {string} label
 * @param {{ defaultValue?: string }} [opts]
 */
export async function promptLine(label, opts = {}) {
  const { defaultValue = "" } = opts;
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`${label}${hint}: `);
  rl.close();
  return answer.trim() || defaultValue;
}

/** @typedef {{ otlpBase: string, otlpHeaders: string }} Last9Config */

const DEFAULT_OTLP_BASE = "https://otlp-aps1.last9.io";

/**
 * @param {{ interactive: boolean, otlpBase?: string, authToken?: string, openBrowser?: boolean }} opts
 * @returns {Promise<Last9Config>}
 */
export async function promptLast9Config(opts) {
  const presetBase = opts.otlpBase?.trim() || DEFAULT_OTLP_BASE;
  const presetHeaders = opts.authToken ? formatOtlpHeaders(opts.authToken) : "";

  if (!opts.interactive) {
    return {
      otlpBase: presetBase,
      otlpHeaders: presetHeaders || "Authorization=Basic REPLACE_WITH_LAST9_OTLP_TOKEN"
    };
  }

  console.log("");
  console.log("Last9 OTLP setup");
  console.log(`Copy endpoint + auth from: ${LAST9_OTEL_INTEGRATION_URL}`);
  console.log("");
  console.log(LAST9_OTEL_ADMIN_NOTE);
  console.log("");

  const shouldOpen =
    opts.openBrowser !== false &&
    (await promptYesNo("Open that page in your browser?", true));

  if (shouldOpen) {
    openInBrowser(LAST9_OTEL_INTEGRATION_URL);
  }

  console.log("");
  const otlpBase = await promptLine("OTLP base URL (from Last9 integration page)", {
    defaultValue: presetBase
  });
  const authToken = await promptLine(
    "OTLP auth token (from your admin if needed; base64 or user:password)"
  );

  return {
    otlpBase: otlpBase || presetBase,
    otlpHeaders: authToken ? formatOtlpHeaders(authToken) : presetHeaders
  };
}

/** @param {string} question @param {boolean} defaultYes */
async function promptYesNo(question, defaultYes) {
  const hint = defaultYes ? " [Y/n]" : " [y/N]";
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`${question}${hint}: `);
  rl.close();
  const normalized = answer.trim().toLowerCase();
  if (!normalized) {
    return defaultYes;
  }
  return normalized === "y" || normalized === "yes";
}

/** @param {string} url */
export function openInBrowser(url) {
  const platform = process.platform;
  /** @type {[string, string[]] | null} */
  let command = null;
  if (platform === "darwin") {
    command = ["open", [url]];
  } else if (platform === "win32") {
    command = ["cmd", ["/c", "start", "", url]];
  } else {
    command = ["xdg-open", [url]];
  }

  const result = spawnSync(command[0], command[1], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    console.log(`Could not open browser — open manually: ${url}`);
  }
}

/** @param {string} raw */
export function formatOtlpHeaders(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (/^authorization=/i.test(trimmed)) {
    return trimmed;
  }
  const token = trimmed.replace(/^Basic\s+/i, "");
  if (token.includes(":") && !looksLikeBase64(token)) {
    const encoded = Buffer.from(token, "utf8").toString("base64");
    return `Authorization=Basic ${encoded}`;
  }
  return `Authorization=Basic ${token}`;
}

/** @param {string} value */
function looksLikeBase64(value) {
  return /^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 16;
}
