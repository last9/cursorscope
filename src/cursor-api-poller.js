import {
  advanceCheckpoint,
  getCheckpointPath,
  loadCheckpoint,
  resolvePollWindow
} from "./cursor-api-checkpoint.js";
import { pollActivityMetrics } from "./cursor-activity-poller.js";
import { resolveBillingSource, shouldRunActivityPoll, getBillingPollConfig } from "./cursor-billing-config.js";
import { pollBillingMetrics } from "./cursor-billing-poller.js";
import { setActivityDayGauge, setBillingDayGauge } from "./telemetry.js";

const pollEnabled = process.env.ENABLE_CURSOR_API_POLLING === "true";
const pollIntervalMs = Number(process.env.CURSOR_API_POLL_INTERVAL_MS || 3_600_000);

let pollTimer;
let pollInFlight = false;

export function maybeStartCursorApiPolling() {
  if (!pollEnabled) {
    return;
  }

  const source = resolveBillingSource();
  if (!source) {
    console.warn(
      "ENABLE_CURSOR_API_POLLING=true, but no billing source is configured (set CURSOR_ADMIN_API_KEY and/or ENABLE_CURSOR_DASHBOARD_POLLING=true)."
    );
    return;
  }

  runPollTick().catch((error) => {
    console.error("Cursor API poll failed:", error.message);
  });

  pollTimer = setInterval(() => {
    runPollTick().catch((error) => {
      console.error("Cursor API poll failed:", error.message);
    });
  }, pollIntervalMs);
  pollTimer.unref?.();
}

export function stopCursorApiPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

export async function runPollTick(options = {}) {
  if (pollInFlight) {
    return { skipped: true, reason: "in_flight" };
  }

  const source = resolveBillingSource();
  if (!source) {
    return { skipped: true, reason: "no_source" };
  }

  pollInFlight = true;
  const config = getBillingPollConfig();
  const checkpointPath = options.checkpointPath ?? getCheckpointPath();
  const checkpoint = loadCheckpoint(checkpointPath);
  const nowMs = options.nowMs ?? Date.now();
  const window = resolvePollWindow(checkpoint, nowMs, {
    lookbackDays: config.lookbackDays,
    refreshDays: config.refreshDays
  });

  try {
    await pollBillingMetrics(window, source, setBillingDayGauge, {
      fetchImpl: options.fetchImpl
    });

    if (shouldRunActivityPoll(source)) {
      await pollActivityMetrics(window, setActivityDayGauge, {
        fetchImpl: options.fetchImpl
      });
    }

    advanceCheckpoint(checkpointPath, nowMs);
    return { ok: true, source, window };
  } finally {
    pollInFlight = false;
  }
}
