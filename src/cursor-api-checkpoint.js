import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const CHECKPOINT_VERSION = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {string} [home]
 */
export function getCheckpointPath(home = process.env.CURSORSCOPE_HOME || process.cwd()) {
  return join(home, ".cursor-api-checkpoint.json");
}

/**
 * @param {string} path
 */
export function loadCheckpoint(path) {
  if (!existsSync(path)) {
    return { version: CHECKPOINT_VERSION, lastSuccessfulPollEndMs: null };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: parsed.version ?? CHECKPOINT_VERSION,
      lastSuccessfulPollEndMs:
        typeof parsed.lastSuccessfulPollEndMs === "number" ? parsed.lastSuccessfulPollEndMs : null
    };
  } catch {
    return { version: CHECKPOINT_VERSION, lastSuccessfulPollEndMs: null };
  }
}

/**
 * @param {string} path
 * @param {number} endMs
 */
export function advanceCheckpoint(path, endMs) {
  const payload = {
    version: CHECKPOINT_VERSION,
    lastSuccessfulPollEndMs: endMs
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

/**
 * @param {{ lastSuccessfulPollEndMs: number | null }} checkpoint
 * @param {number} nowMs
 * @param {{ lookbackDays?: number, refreshDays?: number }} [options]
 */
export function resolvePollWindow(checkpoint, nowMs, options = {}) {
  const lookbackDays = options.lookbackDays ?? 30;
  const refreshDays = options.refreshDays ?? 3;
  const lastEnd = checkpoint.lastSuccessfulPollEndMs;

  if (lastEnd == null) {
    return {
      startMs: nowMs - lookbackDays * MS_PER_DAY,
      endMs: nowMs,
      isFirstRun: true
    };
  }

  const refreshStartMs = nowMs - refreshDays * MS_PER_DAY;
  return {
    startMs: Math.min(lastEnd, refreshStartMs),
    endMs: nowMs,
    isFirstRun: false
  };
}
