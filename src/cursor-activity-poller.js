import { paginateAdmin } from "./cursor-api-client.js";
import { normalizeActivityDay } from "./cursor-billing-day.js";
import { parseDailyUsagePage } from "./cursor-billing-mapper.js";
import { getBillingPollConfig } from "./cursor-billing-config.js";
import { maskEmail } from "./privacy.js";

const ACTIVITY_FIELD_MAP = {
  agentRequests: "cursor.activity.agent_requests",
  chatRequests: "cursor.activity.chat_requests",
  composerRequests: "cursor.activity.composer_requests",
  usageBasedReqs: "cursor.activity.usage_based_requests",
  totalTabsAccepted: "cursor.activity.tabs_accepted",
  totalLinesAdded: "cursor.activity.lines_added",
  totalLinesDeleted: "cursor.activity.lines_deleted"
};

/**
 * @param {{ startMs: number, endMs: number }} window
 * @param {(name: string, value: number, labels: Record<string, string>) => void} setActivityDayGauge
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function pollActivityMetrics(window, setActivityDayGauge, options = {}) {
  const config = getBillingPollConfig();
  if (!config.apiKey) {
    throw new Error("CURSOR_ADMIN_API_KEY is required for activity metrics poll");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maskUser = process.env.CURSOR_MASK_USER_EMAIL === "true" ? maskEmail : (email) => email;

  const rows = await paginateAdmin(
    "/teams/daily-usage-data",
    (page) => ({
      startDate: window.startMs,
      endDate: window.endMs,
      page,
      pageSize: config.pageSize
    }),
    parseDailyUsagePage,
    { apiKey: config.apiKey, baseUrl: config.baseUrl, fetchImpl }
  );

  for (const raw of rows) {
    const row = /** @type {Record<string, unknown>} */ (raw);
    const billingDay = normalizeActivityDay(
      row.day ?? row.date ?? row.billingDay,
      config.timeZone
    );
    const labels = {
      "cursor.billing_day": billingDay,
      "cursor.user.email": maskUser(String(row.email ?? row.userEmail ?? row.user_email ?? "unknown")),
      "cursor.billing.source": "admin_api"
    };

    for (const [field, metricName] of Object.entries(ACTIVITY_FIELD_MAP)) {
      const value = Number(row[field]);
      if (Number.isFinite(value)) {
        setActivityDayGauge(metricName, value, labels);
      }
    }
  }

  return { rowCount: rows.length };
}
