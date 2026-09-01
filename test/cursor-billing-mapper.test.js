import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDailyUsagePage, parseUsageEventsPage } from "../src/cursor-billing-mapper.js";

describe("cursor-billing-mapper", () => {
  it("reads hasNextPage from pagination object", () => {
    const billing = parseUsageEventsPage({
      usageEvents: [{ id: 1 }],
      pagination: { hasNextPage: true }
    });
    assert.equal(billing.hasNextPage, true);

    const activity = parseDailyUsagePage({
      data: [{ day: "2026-06-28" }],
      pagination: { hasNextPage: false }
    });
    assert.equal(activity.hasNextPage, false);
  });
});
