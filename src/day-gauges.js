import { maskEmail } from "./privacy.js";

export const BILLING_DAY_GAUGES = [
  "cursor.billing.charged_usd",
  "cursor.billing.model_cost_usd",
  "cursor.billing.cursor_token_fee_usd",
  "cursor.billing.input_tokens",
  "cursor.billing.output_tokens",
  "cursor.billing.cache_read_tokens",
  "cursor.billing.cache_write_tokens",
  "cursor.billing.events_total"
];

export const BILLING_SPEND_GAUGES = new Set([
  "cursor.billing.charged_usd",
  "cursor.billing.model_cost_usd",
  "cursor.billing.cursor_token_fee_usd"
]);

export const ACTIVITY_DAY_GAUGES = [
  "cursor.activity.agent_requests",
  "cursor.activity.chat_requests",
  "cursor.activity.composer_requests",
  "cursor.activity.usage_based_requests",
  "cursor.activity.tabs_accepted",
  "cursor.activity.lines_added",
  "cursor.activity.lines_deleted"
];

const BILLING_BASE_LABELS = new Set([
  "cursor.billing_day",
  "gen_ai.request.model",
  "cursor.billing.kind",
  "cursor.is_headless",
  "cursor.user.email",
  "cursor.billing.source"
]);

const ACTIVITY_BASE_LABELS = new Set(["cursor.billing_day", "cursor.user.email", "cursor.billing.source"]);

/** @type {Map<string, { value: number, attributes: Record<string, string> }>} */
const billingStore = new Map();
/** @type {Map<string, { value: number, attributes: Record<string, string> }>} */
const activityStore = new Map();

/**
 * @param {import('@opentelemetry/api').Meter} meter
 */
export function registerDayGauges(meter) {
  for (const name of BILLING_DAY_GAUGES) {
    const gauge = meter.createObservableGauge(name, {
      description: `Cursor billing day gauge ${name}`,
      unit: name.endsWith("_usd") ? "USD" : name.endsWith("_tokens") || name.endsWith("_total") ? "{event}" : "1"
    });
    gauge.addCallback((result) => {
      for (const [key, entry] of billingStore.entries()) {
        if (key.startsWith(`${name}:`)) {
          result.observe(entry.value, entry.attributes);
        }
      }
    });
  }

  for (const name of ACTIVITY_DAY_GAUGES) {
    const gauge = meter.createObservableGauge(name, {
      description: `Cursor activity day gauge ${name}`,
      unit: "1"
    });
    gauge.addCallback((result) => {
      for (const [key, entry] of activityStore.entries()) {
        if (key.startsWith(`${name}:`)) {
          result.observe(entry.value, entry.attributes);
        }
      }
    });
  }
}

/**
 * @param {string} name
 * @param {number} value
 * @param {Record<string, string>} labels
 */
export function setBillingDayGauge(name, value, labels) {
  if (!BILLING_DAY_GAUGES.includes(name)) {
    throw new Error(`Unknown billing day gauge: ${name}`);
  }

  const sanitized = sanitizeBillingLabels(name, labels);
  const key = `${name}:${stableStringify(sanitized)}`;
  billingStore.set(key, { value, attributes: sanitized });
}

/**
 * @param {string} name
 * @param {number} value
 * @param {Record<string, string>} labels
 */
export function setActivityDayGauge(name, value, labels) {
  if (!ACTIVITY_DAY_GAUGES.includes(name)) {
    throw new Error(`Unknown activity day gauge: ${name}`);
  }

  const sanitized = sanitizeActivityLabels(labels);
  const key = `${name}:${stableStringify(sanitized)}`;
  activityStore.set(key, { value, attributes: sanitized });
}

/**
 * @param {string} name
 * @param {Record<string, string>} labels
 */
function sanitizeBillingLabels(name, labels) {
  const allowed = new Set(BILLING_BASE_LABELS);
  if (BILLING_SPEND_GAUGES.has(name)) {
    allowed.add("cursor.chargeable");
  }

  const out = {};
  for (const [key, value] of Object.entries(labels)) {
    if (!allowed.has(key)) {
      throw new Error(`Unexpected billing label: ${key}`);
    }
    out[key] = key === "cursor.user.email" && process.env.CURSOR_MASK_USER_EMAIL === "true" ? maskEmail(value) : value;
  }

  for (const required of allowed) {
    if (!Object.prototype.hasOwnProperty.call(out, required)) {
      throw new Error(`Missing billing label: ${required}`);
    }
  }

  return out;
}

/** @param {Record<string, string>} labels */
function sanitizeActivityLabels(labels) {
  const out = {};
  for (const key of ACTIVITY_BASE_LABELS) {
    if (!Object.prototype.hasOwnProperty.call(labels, key)) {
      throw new Error(`Missing activity label: ${key}`);
    }
    const value = labels[key];
    out[key] = key === "cursor.user.email" && process.env.CURSOR_MASK_USER_EMAIL === "true" ? maskEmail(value) : value;
  }
  return out;
}

/** @param {Record<string, string>} value */
function stableStringify(value) {
  const sorted = Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, /** @type {Record<string, string>} */ ({}));
  return JSON.stringify(sorted);
}

export function getDayGaugeStore() {
  return {
    billing: billingStore,
    activity: activityStore
  };
}

export function clearDayGaugeStore() {
  billingStore.clear();
  activityStore.clear();
}
