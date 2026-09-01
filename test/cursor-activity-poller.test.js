import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { pollActivityMetrics } from "../src/cursor-activity-poller.js";

describe("cursor-activity-poller", () => {
  before(() => {
    process.env.CURSOR_ADMIN_API_KEY = "test-key";
    process.env.CURSOR_BILLING_TIMEZONE = "UTC";
  });

  it("maps daily usage rows to activity gauges", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: [
          {
            day: "2026-06-28",
            email: "user@example.com",
            agentRequests: 3,
            chatRequests: 1,
            totalLinesAdded: 42,
            totalLinesDeleted: 7
          }
        ],
        pagination: { hasNextPage: false }
      })
    });

    /** @type {Array<{ name: string, value: number }>} */
    const gauges = [];
    await pollActivityMetrics(
      { startMs: 0, endMs: Date.now() },
      (name, value) => {
        gauges.push({ name, value });
      },
      { fetchImpl }
    );

    const agent = gauges.find((g) => g.name === "cursor.activity.agent_requests");
    assert.ok(agent);
    assert.equal(agent.value, 3);
    assert.equal(gauges.find((g) => g.name === "cursor.activity.lines_added")?.value, 42);
  });
});
