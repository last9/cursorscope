import { toBillingDay } from "./cursor-billing-day.js";

/** @typedef {{
 *   chargedUsd: number,
 *   modelCostUsd: number,
 *   cursorTokenFeeUsd: number
 * }} SpendTotals */

/** @typedef {{
 *   inputTokens: number,
 *   outputTokens: number,
 *   cacheReadTokens: number,
 *   cacheWriteTokens: number,
 *   eventsTotal: number
 * }} TokenTotals */

/**
 * @param {unknown[]} events
 * @param {{ timeZone?: string, source: string, maskUserEmail?: (email: string) => string }} options
 */
export function aggregateBillingEvents(events, options) {
  /** @type {Map<string, { labels: Record<string, string>, totals: SpendTotals }>} */
  const spendBuckets = new Map();
  /** @type {Map<string, { labels: Record<string, string>, totals: TokenTotals }>} */
  const tokenBuckets = new Map();

  const timeZone = options.timeZone ?? "UTC";
  const mask = options.maskUserEmail ?? ((email) => email);

  for (const raw of events) {
    const event = /** @type {Record<string, unknown>} */ (raw);
    const timestamp = Number(event.timestamp ?? event.eventTime ?? event.createdAt ?? 0);
    const billingDay = toBillingDay(timestamp, timeZone);
    const userEmail = mask(String(event.userEmail ?? event.user_email ?? "unknown"));
    const model = String(event.model ?? event.requestedModel ?? "unknown");
    const kind = String(event.kind ?? event.billingKind ?? "unknown");
    const isHeadless = String(Boolean(event.isHeadless ?? event.is_headless));
    const chargeable = String(Boolean(event.isChargeable ?? event.is_chargeable));
    const source = options.source;

    const baseLabels = {
      "cursor.billing_day": billingDay,
      "gen_ai.request.model": model,
      "cursor.billing.kind": kind,
      "cursor.is_headless": isHeadless,
      "cursor.user.email": userEmail,
      "cursor.billing.source": source
    };

    const spendLabels = { ...baseLabels, "cursor.chargeable": chargeable };
    addSpend(spendBuckets, spendLabels, event);
    addTokens(tokenBuckets, baseLabels, event);
  }

  return { spendBuckets, tokenBuckets };
}

/**
 * @param {Map<string, { labels: Record<string, string>, totals: SpendTotals }>} buckets
 * @param {Record<string, string>} labels
 * @param {Record<string, unknown>} event
 */
function addSpend(buckets, labels, event) {
  const key = JSON.stringify(labels);
  if (!buckets.has(key)) {
    buckets.set(key, { labels, totals: { chargedUsd: 0, modelCostUsd: 0, cursorTokenFeeUsd: 0 } });
  }
  const entry = buckets.get(key);
  const tokenUsage = /** @type {Record<string, unknown>} */ (event.tokenUsage ?? event.token_usage ?? {});
  entry.totals.chargedUsd += centsToUsd(event.chargedCents ?? event.charged_cents);
  entry.totals.modelCostUsd += centsToUsd(tokenUsage.totalCents ?? tokenUsage.total_cents);
  entry.totals.cursorTokenFeeUsd += centsToUsd(event.cursorTokenFee ?? event.cursor_token_fee);
}

/**
 * @param {Map<string, { labels: Record<string, string>, totals: TokenTotals }>} buckets
 * @param {Record<string, string>} labels
 * @param {Record<string, unknown>} event
 */
function addTokens(buckets, labels, event) {
  const key = JSON.stringify(labels);
  if (!buckets.has(key)) {
    buckets.set(key, {
      labels,
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        eventsTotal: 0
      }
    });
  }
  const entry = buckets.get(key);
  const tokenUsage = /** @type {Record<string, unknown>} */ (event.tokenUsage ?? event.token_usage ?? {});
  entry.totals.eventsTotal += 1;
  entry.totals.inputTokens += num(tokenUsage.inputTokens ?? tokenUsage.input_tokens);
  entry.totals.outputTokens += num(tokenUsage.outputTokens ?? tokenUsage.output_tokens);
  entry.totals.cacheReadTokens += num(tokenUsage.cacheReadTokens ?? tokenUsage.cache_read_tokens);
  entry.totals.cacheWriteTokens += num(tokenUsage.cacheWriteTokens ?? tokenUsage.cache_write_tokens);
}

/** @param {unknown} value */
function centsToUsd(value) {
  const cents = Number(value);
  return Number.isFinite(cents) ? cents / 100 : 0;
}

/** @param {unknown} value */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{ spendBuckets: Map<string, { labels: Record<string, string>, totals: SpendTotals }>, tokenBuckets: Map<string, { labels: Record<string, string>, totals: TokenTotals }> }} aggregated
 * @param {(name: string, value: number, labels: Record<string, string>) => void} emitGauge
 */
export function emitBillingBuckets(aggregated, emitGauge) {
  for (const { labels, totals } of aggregated.spendBuckets.values()) {
    emitGauge("cursor.billing.charged_usd", totals.chargedUsd, labels);
    emitGauge("cursor.billing.model_cost_usd", totals.modelCostUsd, labels);
    emitGauge("cursor.billing.cursor_token_fee_usd", totals.cursorTokenFeeUsd, labels);
  }
  for (const { labels, totals } of aggregated.tokenBuckets.values()) {
    emitGauge("cursor.billing.input_tokens", totals.inputTokens, labels);
    emitGauge("cursor.billing.output_tokens", totals.outputTokens, labels);
    emitGauge("cursor.billing.cache_read_tokens", totals.cacheReadTokens, labels);
    emitGauge("cursor.billing.cache_write_tokens", totals.cacheWriteTokens, labels);
    emitGauge("cursor.billing.events_total", totals.eventsTotal, labels);
  }
}
