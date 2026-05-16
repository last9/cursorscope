import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

describe("telemetry", () => {
  /** @type {typeof import('../src/telemetry.js')} */
  let telemetry;

  before(async () => {
    process.env.DEBUG_OTEL = "false";
    process.env.LOG_OTEL_EXPORT_ERRORS = "false";
    process.env.CURSOR_TRACK_ATTRIBUTED_TOKENS = "true";
    process.env.CURSOR_LOG_TOOL_DETAILS = "false";
    process.env.CURSOR_LOG_USER_PROMPTS = "false";
    process.env.METRIC_EXPORT_INTERVAL_MS = "3600000";
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:9/v1/traces";
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "http://127.0.0.1:9/v1/metrics";
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "http://127.0.0.1:9/v1/logs";
    telemetry = await import("../src/telemetry.js");
  });

  after(async () => {
    await telemetry.flushTelemetry();
  });

  it("recordHookEvent returns shouldFlush on stop", () => {
    const result = telemetry.recordHookEvent({
      hook_event_name: "beforeSubmitPrompt",
      conversation_id: "conv-test",
      generation_id: "gen-test",
      model: "claude-sonnet-4-20250514",
      user_email: "test@example.com"
    });
    assert.equal(result.shouldFlush, false);

    const stop = telemetry.recordHookEvent({
      hook_event_name: "stop",
      conversation_id: "conv-test",
      generation_id: "gen-test",
      status: "completed",
      loop_count: 0
    });
    assert.equal(stop.shouldFlush, true);
  });

  it("records MCP execution hook without throwing", () => {
    const result = telemetry.recordHookEvent({
      hook_event_name: "afterMCPExecution",
      conversation_id: "conv-mcp",
      generation_id: "gen-mcp",
      model: "gpt-4o",
      tool_use_id: "tool-mcp-1",
      tool_name: "search",
      url: "https://mcp.example.com/sse",
      tool_input: JSON.stringify({ query: "test" }),
      result_json: JSON.stringify({ usage: { input_tokens: 12, output_tokens: 8 } }),
      duration: 250
    });
    assert.equal(result.shouldFlush, false);
  });

  it("records file edit line stats hook without throwing", () => {
    const result = telemetry.recordHookEvent({
      hook_event_name: "afterFileEdit",
      conversation_id: "conv-edit",
      file_path: "/tmp/example.ts",
      edits: [{ old_string: "a", new_string: "a\nb" }]
    });
    assert.equal(result.shouldFlush, false);
  });

  it("records preCompact with context token fields", () => {
    const result = telemetry.recordHookEvent({
      hook_event_name: "preCompact",
      conversation_id: "conv-compact",
      context_tokens: 120000,
      context_window_size: 128000,
      context_usage_percent: 94,
      trigger: "auto"
    });
    assert.equal(result.shouldFlush, false);
  });

  it("observeCursorApiMetric accepts gauge updates", () => {
    assert.doesNotThrow(() => {
      telemetry.observeCursorApiMetric("cursor_team_tokens", 42, {
        cursor_date: "2026-05-16"
      });
    });
  });

  it("getOtelExportConfig exposes service and endpoints", () => {
    const config = telemetry.getOtelExportConfig();
    assert.ok(config.serviceName);
    assert.match(config.tracesEndpoint, /\/v1\/traces$/);
    assert.match(config.metricsEndpoint, /\/v1\/metrics$/);
    assert.match(config.logsEndpoint, /\/v1\/logs$/);
  });

  it("emitDebugTelemetry runs flush path", async () => {
    assert.doesNotThrow(() => telemetry.emitDebugTelemetry());
    await assert.doesNotReject(telemetry.flushTelemetry());
  });
});
