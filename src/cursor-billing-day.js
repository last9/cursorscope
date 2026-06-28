const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {number} epochMs
 * @param {string} [timeZone]
 */
export function toBillingDay(epochMs, timeZone = "UTC") {
  if (!Number.isFinite(epochMs)) {
    return "unknown";
  }
  return formatYmdInTimeZone(new Date(epochMs), timeZone);
}

/**
 * Normalize daily-usage-data `day` to billing_day (API usually returns YYYY-MM-DD).
 * @param {string | number | undefined} apiDay
 * @param {string} [timeZone]
 */
export function normalizeActivityDay(apiDay, timeZone = "UTC") {
  if (typeof apiDay === "string" && DAY_RE.test(apiDay)) {
    return apiDay;
  }
  if (typeof apiDay === "number" && Number.isFinite(apiDay)) {
    return toBillingDay(apiDay, timeZone);
  }
  if (typeof apiDay === "string") {
    const parsed = Date.parse(apiDay);
    if (Number.isFinite(parsed)) {
      return toBillingDay(parsed, timeZone);
    }
  }
  return "unknown";
}

/**
 * @param {Date} date
 * @param {string} timeZone
 */
function formatYmdInTimeZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }
}
