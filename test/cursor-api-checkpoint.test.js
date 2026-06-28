import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePollWindow } from "../src/cursor-api-checkpoint.js";

describe("cursor-api-checkpoint", () => {
  it("uses lookback on first run", () => {
    const now = Date.parse("2026-06-28T12:00:00Z");
    const window = resolvePollWindow({ lastSuccessfulPollEndMs: null }, now, { lookbackDays: 30 });
    assert.equal(window.isFirstRun, true);
    assert.equal(window.endMs, now);
    assert.equal(window.startMs, now - 30 * 24 * 60 * 60 * 1000);
  });

  it("slides refresh window after checkpoint", () => {
    const now = Date.parse("2026-06-28T12:00:00Z");
    const lastEnd = now - 2 * 24 * 60 * 60 * 1000;
    const window = resolvePollWindow({ lastSuccessfulPollEndMs: lastEnd }, now, { refreshDays: 3 });
    assert.equal(window.isFirstRun, false);
    assert.equal(window.endMs, now);
    assert.equal(window.startMs, now - 3 * 24 * 60 * 60 * 1000);
  });
});
