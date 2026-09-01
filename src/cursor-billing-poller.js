import { paginateAdmin } from "./cursor-api-client.js";
import { aggregateBillingEvents, emitBillingBuckets } from "./cursor-billing-aggregator.js";
import { parseUsageEventsPage } from "./cursor-billing-mapper.js";
import { getBillingPollConfig } from "./cursor-billing-config.js";
import { buildDashboardSessionCookie, readCursorAccessToken } from "./cursor-dashboard-auth.js";
import { maskEmail } from "./privacy.js";

/**
 * @param {{ startMs: number, endMs: number }} window
 * @param {"admin" | "dashboard"} source
 * @param {(name: string, value: number, labels: Record<string, string>) => void} setBillingDayGauge
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function pollBillingMetrics(window, source, setBillingDayGauge, options = {}) {
  const config = getBillingPollConfig();
  const maskUser = process.env.CURSOR_MASK_USER_EMAIL === "true" ? maskEmail : (email) => email;
  const fetchImpl = options.fetchImpl ?? fetch;

  const events =
    source === "admin"
      ? await fetchAdminUsageEvents(window, config, fetchImpl)
      : await fetchDashboardUsageEvents(window, config, fetchImpl);

  const aggregated = aggregateBillingEvents(events, {
    timeZone: config.timeZone,
    source: source === "admin" ? "admin_api" : "dashboard_api",
    maskUserEmail: maskUser
  });

  emitBillingBuckets(aggregated, setBillingDayGauge);
  return { eventCount: events.length };
}

/**
 * @param {{ startMs: number, endMs: number }} window
 * @param {ReturnType<typeof getBillingPollConfig>} config
 * @param {typeof fetch} fetchImpl
 */
async function fetchAdminUsageEvents(window, config, fetchImpl) {
  if (!config.apiKey) {
    throw new Error("CURSOR_ADMIN_API_KEY is required for admin billing poll");
  }

  return paginateAdmin(
    "/teams/filtered-usage-events",
    (page) => ({
      startDate: window.startMs,
      endDate: window.endMs,
      page,
      pageSize: config.pageSize
    }),
    parseUsageEventsPage,
    { apiKey: config.apiKey, baseUrl: config.baseUrl, fetchImpl, timeoutMs: config.requestTimeoutMs }
  );
}

/**
 * @param {{ startMs: number, endMs: number }} window
 * @param {ReturnType<typeof getBillingPollConfig>} config
 * @param {typeof fetch} fetchImpl
 */
async function fetchDashboardUsageEvents(window, config, fetchImpl) {
  const token = readCursorAccessToken();
  if (!token) {
    throw new Error("Could not read Cursor dashboard session token from state.vscdb");
  }

  const cookie = buildDashboardSessionCookie(token);
  /** @type {unknown[]} */
  const merged = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response;
    try {
      response = await fetchImpl(config.dashboardUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie
        },
        body: JSON.stringify({
          startDate: window.startMs,
          endDate: window.endMs,
          page,
          pageSize: config.pageSize
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Cursor dashboard API request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Cursor dashboard API ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const parsed = parseUsageEventsPage(payload);
    merged.push(...parsed.items);
    hasNextPage = parsed.hasNextPage;
    if (hasNextPage) {
      page += 1;
    }
  }

  return merged;
}
