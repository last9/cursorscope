import { observeCursorApiMetric } from "./telemetry.js";

const baseUrl = process.env.CURSOR_API_BASE_URL || "https://api.cursor.com";
const adminApiKey = process.env.CURSOR_ADMIN_API_KEY;
const pollEnabled = process.env.ENABLE_CURSOR_API_POLLING === "true";
const pollIntervalMs = Number(process.env.CURSOR_API_POLL_INTERVAL_MS || 300000);

let pollTimer;

export function maybeStartCursorApiPolling() {
  if (!pollEnabled) {
    return;
  }
  if (!adminApiKey) {
    console.warn("ENABLE_CURSOR_API_POLLING=true, but CURSOR_ADMIN_API_KEY is missing.");
    return;
  }

  pollOnce().catch((error) => {
    console.error("Cursor API poll failed:", error.message);
  });

  pollTimer = setInterval(() => {
    pollOnce().catch((error) => {
      console.error("Cursor API poll failed:", error.message);
    });
  }, pollIntervalMs);
}

export function stopCursorApiPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
}

async function pollOnce() {
  const teamId = process.env.CURSOR_TEAM_ID;
  if (!teamId) {
    console.warn("Skipping Cursor API poll because CURSOR_TEAM_ID is not set.");
    return;
  }

  // This endpoint may evolve. Keep this helper easy to customize.
  const usageUrl = new URL(`/teams/${teamId}/daily-usage-data`, baseUrl);
  const response = await fetch(usageUrl, {
    headers: {
      Authorization: `Bearer ${adminApiKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Cursor API ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const rows = normalizeDailyUsageRows(payload);

  for (const row of rows) {
    for (const [metricName, value] of Object.entries(row.numericMetrics)) {
      observeCursorApiMetric(metricName, value, {
        cursor_team_id: teamId,
        cursor_date: row.date
      });
    }
  }
}

function normalizeDailyUsageRows(payload) {
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeRow(item));
  }
  if (Array.isArray(payload?.data)) {
    return payload.data.map((item) => normalizeRow(item));
  }
  return [];
}

function normalizeRow(item) {
  const date = item.date || item.day || "unknown";
  const numericMetrics = {};

  for (const [key, value] of Object.entries(item || {})) {
    if (typeof value === "number") {
      numericMetrics[`cursor_api_${key}`] = value;
    }
  }

  return { date, numericMetrics };
}
