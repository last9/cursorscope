import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminApiAuthHeader,
  CursorApiError,
  paginateAdmin,
  postAdminJson
} from "../src/cursor-api-client.js";

describe("cursor-api-client", () => {
  it("builds Basic auth header", () => {
    assert.equal(adminApiAuthHeader("test-key"), `Basic ${Buffer.from("test-key:").toString("base64")}`);
  });

  it("paginates until hasNextPage is false", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () =>
          calls === 1
            ? { usageEvents: [{ id: 1 }], hasNextPage: true }
            : { usageEvents: [{ id: 2 }], hasNextPage: false }
      };
    };

    const items = await paginateAdmin(
      "/teams/filtered-usage-events",
      (page) => ({ page }),
      (payload) => ({
        items: payload.usageEvents,
        hasNextPage: payload.hasNextPage
      }),
      { apiKey: "key", fetchImpl }
    );

    assert.equal(items.length, 2);
    assert.equal(calls, 2);
  });

  it("throws on 401 without partial merge", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({})
    });

    await assert.rejects(
      () =>
        postAdminJson("/teams/filtered-usage-events", {}, {
          apiKey: "bad",
          fetchImpl
        }),
      (error) => {
        assert.ok(error instanceof CursorApiError);
        assert.equal(error.status, 401);
        return true;
      }
    );
  });
});
