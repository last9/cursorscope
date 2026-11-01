import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

// Exercise the same route and body parsers as the ingestor, with an in-memory recorder.
async function receiver(t) {
  const { createHookRouter } = await import("../src/hook-receiver.js");
  const events = [];
  const app = express();
  app.use(createHookRouter((event) => events.push(event)));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { events, url: `http://127.0.0.1:${server.address().port}/cursor/hooks` };
}

test("raw transport retains the legacy envelope and all hook payload fields", async (t) => {
  const { events, url } = await receiver(t);
  const input = {
    hook_event_name: "preToolUse", user_email: "alice@example.com", workspace_roots: ["/repo", "/other"],
    conversation_id: "c", generation_id: "g", session_id: "s", model: "m", cursor_version: "v",
    tool_input: { text: "é\n&=+\\", empty: null }, arbitrary_future_field: [true, 1]
  };
  const response = await fetch(url, { method: "POST", body: new URLSearchParams({
    hook_input: JSON.stringify(input), user: "fallback", repo: "/fallback", event: "fallback"
  }) });
  assert.equal(response.status, 202);
  const { ts, ...event } = events[0];
  assert.ok(Number.isFinite(Date.parse(ts)));
  assert.deepEqual(event, {
    event_name: "preToolUse", hook_event_name: "preToolUse", source: "cursor_hook",
    user: input.user_email, repo: "/repo", conversation_id: "c", generation_id: "g", session_id: "s",
    model: "m", cursor_version: "v", workspace_roots: input.workspace_roots, data: input
  });
});

test("raw transport retains caller fallbacks, empty stdin and malformed input", async (t) => {
  const { events, url } = await receiver(t);
  for (const input of ['{"conversation_id":"c"}', "", "not json\n"]) {
    const response = await fetch(url, { method: "POST", body: new URLSearchParams({
      hook_input: input, user: "local user", repo: "/repo with & and é", event: "beforeReadFile"
    }) });
    assert.equal(response.status, 202);
  }
  for (const event of events) {
    assert.equal(event.user, "local user");
    assert.equal(event.repo, "/repo with & and é");
    assert.equal(event.event_name, "beforeReadFile");
    assert.equal(event.generation_id, null);
    assert.equal(event.model, null);
    assert.equal(event.cursor_version, null);
    assert.deepEqual(event.workspace_roots, []);
  }
  assert.equal(events[0].session_id, "c");
  assert.equal(events[1].conversation_id, null);
  assert.equal(events[1].session_id, null);
  assert.deepEqual(events[1].data, {});
  assert.deepEqual(events[2].data, { raw_stdin: "not json\n" });
});

test("existing JSON envelopes remain accepted without re-enrichment", async (t) => {
  const { events, url } = await receiver(t);
  const input = { event_name: "stop", ts: "2020-01-01", repo: "/original", data: { anything: true } };
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(response.status, 202);
  assert.deepEqual(events, [{ ...input, source: "cursor_hook" }]);
});

test("form encoding overhead does not shrink the one MiB hook payload limit", async (t) => {
  const { events, url } = await receiver(t);
  const input = JSON.stringify({ content: "\u0800".repeat(349520) });
  assert.ok(Buffer.byteLength(input) <= 1048576);
  const response = await fetch(url, { method: "POST", body: new URLSearchParams({
    hook_input: input, user: "user@example.com", repo: "/workspace/with/a/long/path", event: "afterFileEdit"
  }) });
  assert.equal(response.status, 202);
  assert.equal(events[0].data.content.length, 349520);
});
