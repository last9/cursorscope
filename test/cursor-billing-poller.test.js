import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { pollBillingMetrics } from "../src/cursor-billing-poller.js";

describe("cursor-billing-poller", () => {
  before(() => {
    process.env.CURSOR_ADMIN_API_KEY = "test-key";
    process.env.CURSOR_BILLING_TIMEZONE = "UTC";
  });

  after(() => {
    delete process.env.CURSOR_ADMIN_API_KEY;
  });

  it("emits billing gauges from admin API pages", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        usageEvents: [
          {
            timestamp: Date.parse("2026-06-28T10:00:00Z"),
            userEmail: "user@example.com",
            model: "claude-sonnet",
            kind: "usage",
            isHeadless: false,
            isChargeable: true,
            chargedCents: 200,
            tokenUsage: { totalCents: 180, inputTokens: 100, outputTokens: 20 }
          }
        ],
        pagination: { hasNextPage: false }
      })
    });

    /** @type {Array<{ name: string, value: number, labels: Record<string, string> }>} */
    const gauges = [];
    await pollBillingMetrics(
      { startMs: 0, endMs: Date.now() },
      "admin",
      (name, value, labels) => {
        gauges.push({ name, value, labels });
      },
      { fetchImpl }
    );

    const charged = gauges.find((g) => g.name === "cursor.billing.charged_usd");
    assert.ok(charged);
    assert.equal(charged.value, 2);
    assert.equal(charged.labels["cursor.is_headless"], "false");
    assert.equal(charged.labels["cursor.billing.source"], "admin_api");
  });
});
