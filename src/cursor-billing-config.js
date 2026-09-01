/**
 * @returns {"admin" | "dashboard" | null}
 */
export function resolveBillingSource() {
  const configured = (process.env.CURSOR_BILLING_SOURCE || "auto").toLowerCase();
  const hasAdminKey = Boolean(process.env.CURSOR_ADMIN_API_KEY?.trim());
  const dashboardEnabled = process.env.ENABLE_CURSOR_DASHBOARD_POLLING === "true";

  if (configured === "admin") {
    return hasAdminKey ? "admin" : null;
  }
  if (configured === "dashboard") {
    return dashboardEnabled ? "dashboard" : null;
  }
  if (hasAdminKey) {
    return "admin";
  }
  if (dashboardEnabled) {
    return "dashboard";
  }
  return null;
}

export function shouldRunActivityPoll(source) {
  return source === "admin";
}

export function getBillingPollConfig() {
  const lookbackDays = parsePositiveInt(process.env.CURSOR_BILLING_LOOKBACK_DAYS, 30);
  const refreshDays = parsePositiveInt(process.env.CURSOR_BILLING_REFRESH_DAYS, 3);
  const pageSize = parsePositiveInt(process.env.CURSOR_BILLING_PAGE_SIZE, 100);

  return {
    baseUrl: process.env.CURSOR_API_BASE_URL || "https://api.cursor.com",
    apiKey: process.env.CURSOR_ADMIN_API_KEY || "",
    timeZone: process.env.CURSOR_BILLING_TIMEZONE || "UTC",
    lookbackDays,
    refreshDays,
    pageSize,
    dashboardUrl:
      process.env.CURSOR_DASHBOARD_API_URL ||
      "https://cursor.com/api/dashboard/get-filtered-usage-events",
    requestTimeoutMs: parsePositiveInt(process.env.CURSOR_API_REQUEST_TIMEOUT_MS, 60_000)
  };
}

/** @param {string | undefined} raw @param {number} fallback */
function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
