import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import { createHookRouter } from "../src/hook-receiver.js";

let telemetry, server, endpoint, releaseStart;
const delivered = [];
const spans = [];

before(async () => {
  const app = express();
  app.post("/v1/:signal", express.json({ limit: "4mb" }), (req, res) => {
    for (const resource of req.body.resourceSpans || []) {
      for (const scope of resource.scopeSpans || []) spans.push(...scope.spans);
    }
    res.json({});
  });
  // Hold only the start request, leaving the real hook router and consumer intact.
  app.use("/delayed", (_req, _res, next) => { releaseStart = next; });
  const router = createHookRouter((event) => {
    telemetry.recordHookEvent(event);
    delivered.push(event.hook_event_name);
  });
  app.use("/delayed", router);
  app.use(router);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  endpoint = `http://127.0.0.1:${server.address().port}`;
  process.env.OTEL_EXPORTER_OTLP_HEADERS = "";
  for (const signal of ["TRACES", "METRICS", "LOGS"]) {
    process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`] = `${endpoint}/v1/${signal.toLowerCase()}`;
  }
  process.env.METRIC_EXPORT_INTERVAL_MS = "3600000";
  process.env.STALE_SWEEP_INTERVAL_MS = "3600000";
  process.env.CURSOR_LOG_TOOL_DETAILS = "false";
  telemetry = await import("../src/telemetry.js");
});

after(async () => {
  await telemetry?.shutdownTelemetry();
  server?.closeAllConnections();
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
});

async function eventually(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await delay(5);
  assert.ok(predicate(), "hook delivery did not complete");
}

async function forward(event, toolUseId, delayed = false, extra = {}) {
  const child = spawn("scripts/cursorscope-forward.sh", [event], {
    env: { ...process.env, CURSOR_HOOK_ENDPOINT: `${endpoint}${delayed ? "/delayed" : ""}/cursor/hooks` },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.resume();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify({
    hook_event_name: event, tool_use_id: toolUseId, tool_name: "Read",
    conversation_id: toolUseId, generation_id: toolUseId, ...extra,
    duration_ms: 12, error_message: event === "postToolUseFailure" ? "read failed" : undefined
  }));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(code, 0, stderr);
}

for (const [start, finish] of [
  ["preToolUse", "postToolUse"],
  ["preToolUse", "postToolUseFailure"],
  ["beforeShellExecution", "afterShellExecution"],
  ["beforeMCPExecution", "afterMCPExecution"],
  ["beforeReadFile", "postToolUse"]
]) {
  test(`${finish} before a delayed ${start} exports one span and leaves no active tool`, async () => {
    delivered.length = 0;
    releaseStart = undefined;
    const id = `reordered-${start}-${finish}`;
    await forward(start, id, true);
    await eventually(() => releaseStart);
    await forward(finish, id);
    await eventually(() => delivered.length === 1);
    await delay(150);
    releaseStart();
    await eventually(() => delivered.length === 2);
    assert.deepEqual(delivered, [finish, start]);
    await telemetry.flushTelemetry();
    const completed = spans.filter((span) => span.attributes.some(
      (attr) => attr.key === "gen_ai.tool.call.id" && attr.value.stringValue === id));
    assert.equal(completed.length, 1, "one completed tool span must be exported");
    assert.equal(completed[0].status.code || 0, finish === "postToolUseFailure" ? 2 : 0);
    assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 0);
  });
}

test("ordered tool requests still complete normally and unrelated starts stay active", async () => {
  delivered.length = 0;
  await forward("preToolUse", "ordered-tool");
  await eventually(() => delivered.length === 1);
  assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 1);
  await forward("postToolUse", "ordered-tool");
  await eventually(() => delivered.length === 2);
  assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 0);
  await telemetry.flushTelemetry();
  assert.equal(spans.filter((span) => span.attributes.some(
    (attr) => attr.key === "gen_ai.tool.call.id" && attr.value.stringValue === "ordered-tool")).length, 1);
});

test("completion records expire both on lookup and during the stale sweep", () => {
  const record = (hook_event_name, tool_use_id) => telemetry.recordHookEvent({ hook_event_name, tool_use_id, tool_name: "Read" });
  record("postToolUse", "expired-completion");
  telemetry._testHooks.backdateToolCompletion("expired-completion", 6 * 60 * 1000);
  record("preToolUse", "expired-completion");
  assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 1, "expired completion must not suppress a new start");
  record("postToolUse", "expired-completion");
  const count = telemetry._testHooks.getCompletedToolCallCount();
  telemetry._testHooks.backdateToolCompletion("expired-completion", 6 * 60 * 1000);
  telemetry.sweepStaleSpans();
  assert.equal(telemetry._testHooks.getCompletedToolCallCount(), count - 1);
  record("preToolUse", "ordered-tool");
  assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 0, "sweep must retain fresh completions");
});

test("completion history evicts the oldest ID at its capacity", async () => {
  for (let i = 0; i <= 10_000; i++) {
    telemetry.recordHookEvent({ hook_event_name: "postToolUse", tool_use_id: `capacity-${i}`, tool_name: "Read" });
    // Keep the real exporter below its batch queue limit while filling the cache.
    if (i % 500 === 0) await telemetry.flushTelemetry();
  }
  assert.equal(telemetry._testHooks.getCompletedToolCallCount(), 10_000);
  telemetry.recordHookEvent({ hook_event_name: "preToolUse", tool_use_id: "capacity-10000", tool_name: "Read" });
  assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 0);
  telemetry.recordHookEvent({ hook_event_name: "preToolUse", tool_use_id: "capacity-0", tool_name: "Read" });
  assert.equal(telemetry._testHooks.getActiveMapSizes().toolCalls, 1);
  telemetry.recordHookEvent({ hook_event_name: "postToolUse", tool_use_id: "capacity-0", tool_name: "Read" });
});

for (const status of ["completed", "aborted", "error"]) {
  test(`stop before a delayed prompt preserves ${status} and leaves no active interaction`, async () => {
    delivered.length = 0;
    releaseStart = undefined;
    const id = `prompt-race-${status}`;
    await forward("beforeSubmitPrompt", id, true);
    await eventually(() => releaseStart);
    await forward("stop", id, false, { status, loop_count: 2 });
    await eventually(() => delivered.length === 1);
    await delay(150);
    releaseStart();
    await eventually(() => delivered.length === 2);
    assert.equal(telemetry._testHooks.getActiveMapSizes().interactions, 0);
    await telemetry.flushTelemetry();
    const completed = spans.filter((span) => span.attributes.some(
      (attr) => attr.key === "gen_ai.response.id" && attr.value.stringValue === id));
    assert.equal(completed.length, 1);
    const attrs = Object.fromEntries(completed[0].attributes.map((attr) => [attr.key, attr.value]));
    assert.equal(attrs["cursor.agent.status"].stringValue, status);
    assert.equal(Number(attrs["cursor.agent.loop_count"].intValue), 2);
    assert.equal(attrs["cursor.interaction.end_reason"].stringValue, "stop");
    assert.equal(completed[0].status.code || 0, status === "error" ? 2 : 0);
  });
}

test("a late generation cannot close a newer prompt in the same conversation", () => {
  const record = (hook_event_name, generation_id) => telemetry.recordHookEvent({
    hook_event_name, conversation_id: "shared-conversation", generation_id, status: "aborted"
  });
  record("beforeSubmitPrompt", "current-generation");
  record("stop", "older-generation");
  record("beforeSubmitPrompt", "older-generation");
  assert.equal(telemetry._testHooks.getActiveMapSizes().interactions, 1);
  record("stop", "current-generation");
  assert.equal(telemetry._testHooks.getActiveMapSizes().interactions, 0);
});

test("generation completions expire on lookup and sweep and retain only 10000 IDs", async () => {
  const record = (hook_event_name, generation_id) => telemetry.recordHookEvent({ hook_event_name, generation_id });
  record("stop", "expired-generation");
  telemetry._testHooks.backdateGenerationCompletion("expired-generation", 6 * 60 * 1000);
  record("beforeSubmitPrompt", "expired-generation");
  assert.equal(telemetry._testHooks.getActiveMapSizes().interactions, 1);
  record("stop", "expired-generation");
  const count = telemetry._testHooks.getCompletedGenerationCount();
  telemetry._testHooks.backdateGenerationCompletion("expired-generation", 6 * 60 * 1000);
  telemetry.sweepStaleSpans();
  assert.equal(telemetry._testHooks.getCompletedGenerationCount(), count - 1);
  for (let i = 0; i <= 10_000; i++) {
    record("stop", `generation-capacity-${i}`);
    if (i % 500 === 0) await telemetry.flushTelemetry();
  }
  assert.equal(telemetry._testHooks.getCompletedGenerationCount(), 10_000);
  record("beforeSubmitPrompt", "generation-capacity-10000");
  assert.equal(telemetry._testHooks.getActiveMapSizes().interactions, 0);
  record("beforeSubmitPrompt", "generation-capacity-0");
  assert.equal(telemetry._testHooks.getActiveMapSizes().interactions, 1);
  record("stop", "generation-capacity-0");
});
