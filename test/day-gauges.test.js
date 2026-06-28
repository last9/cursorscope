import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

describe("day-gauges", () => {
  /** @type {typeof import('../src/day-gauges.js')} */
  let dayGauges;

  before(async () => {
    process.env.CURSOR_MASK_USER_EMAIL = "false";
    dayGauges = await import("../src/day-gauges.js");
    dayGauges.clearDayGaugeStore();
  });

  after(() => {
    dayGauges.clearDayGaugeStore();
  });

  it("overwrites gauge value on re-poll", () => {
    const labels = {
      "cursor.billing_day": "2026-06-28",
      "gen_ai.request.model": "gpt-4o",
      "cursor.billing.kind": "usage",
      "cursor.is_headless": "false",
      "cursor.user.email": "user@example.com",
      "cursor.billing.source": "admin_api",
      "cursor.chargeable": "true"
    };

    dayGauges.setBillingDayGauge("cursor.billing.charged_usd", 1, labels);
    dayGauges.setBillingDayGauge("cursor.billing.charged_usd", 2, labels);

    const values = [...dayGauges.getDayGaugeStore().billing.values()].map((entry) => entry.value);
    assert.deepEqual(values, [2]);
  });

  it("rejects unknown billing metric names", () => {
    assert.throws(() => {
      dayGauges.setBillingDayGauge("cursor.billing.unknown", 1, {});
    });
  });
});
