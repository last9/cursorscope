import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateBillingEvents, emitBillingBuckets } from "../src/cursor-billing-aggregator.js";

describe("cursor-billing-aggregator", () => {
  it("sums two events in the same bucket", () => {
    const events = [
      {
        timestamp: Date.parse("2026-06-28T10:00:00Z"),
        userEmail: "a@example.com",
        model: "gpt-4o",
        kind: "usage",
        isHeadless: true,
        isChargeable: true,
        chargedCents: 100,
        tokenUsage: { totalCents: 80, inputTokens: 10, outputTokens: 5 }
      },
      {
        timestamp: Date.parse("2026-06-28T11:00:00Z"),
        userEmail: "a@example.com",
        model: "gpt-4o",
        kind: "usage",
        isHeadless: true,
        isChargeable: true,
        chargedCents: 50,
        tokenUsage: { totalCents: 40, inputTokens: 3, outputTokens: 2 }
      }
    ];

    const aggregated = aggregateBillingEvents(events, {
      timeZone: "UTC",
      source: "admin_api"
    });

    /** @type {Record<string, number>} */
    const emitted = {};
    emitBillingBuckets(aggregated, (name, value) => {
      emitted[name] = value;
    });

    assert.equal(emitted["cursor.billing.charged_usd"], 1.5);
    assert.equal(emitted["cursor.billing.input_tokens"], 13);
    assert.equal(emitted["cursor.billing.events_total"], 2);
  });
});
