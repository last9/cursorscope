import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeActivityDay, toBillingDay } from "../src/cursor-billing-day.js";

describe("cursor-billing-day", () => {
  it("buckets UTC timestamps to billing day", () => {
    assert.equal(toBillingDay(Date.parse("2026-06-28T07:00:00Z"), "UTC"), "2026-06-28");
  });

  it("shifts billing day for US Pacific timezone", () => {
    assert.equal(
      toBillingDay(Date.parse("2026-06-28T06:00:00Z"), "America/Los_Angeles"),
      "2026-06-27"
    );
  });

  it("accepts API day strings", () => {
    assert.equal(normalizeActivityDay("2026-06-27", "UTC"), "2026-06-27");
  });
});
