import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

describe("telemetry bug fixes", () => {
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

  // ── stale span sweep ───────────────────────────────────────────────────────

  describe("stale span sweep (memory leak fix)", () => {
    it("preToolUse adds entry to activeToolCalls", () => {
      const before = telemetry._testHooks.getActiveMapSizes().toolCalls;
      telemetry.recordHookEvent({
        hook_event_name: "preToolUse",
        tool_use_id: "stale-sweep-test-1",
        tool_name: "Read",
        conversation_id: "conv-stale",
        generation_id: "gen-stale",
        user_email: "test@example.com"
      });
      assert.equal(
        telemetry._testHooks.getActiveMapSizes().toolCalls,
        before + 1,
        "map should grow by 1 after preToolUse"
      );
    });

    it("postToolUse removes entry from activeToolCalls", () => {
      const sizeAfterPre = telemetry._testHooks.getActiveMapSizes().toolCalls;
      telemetry.recordHookEvent({
        hook_event_name: "postToolUse",
        tool_use_id: "stale-sweep-test-1",
        tool_name: "Read",
        conversation_id: "conv-stale",
        generation_id: "gen-stale",
        user_email: "test@example.com"
      });
      assert.equal(
        telemetry._testHooks.getActiveMapSizes().toolCalls,
        sizeAfterPre - 1,
        "map should shrink by 1 after matching postToolUse"
      );
    });

    it("sweepStaleSpans removes entries past TTL", () => {
      // Add a tool call
      telemetry.recordHookEvent({
        hook_event_name: "preToolUse",
        tool_use_id: "stale-sweep-test-2",
        tool_name: "Bash",
        conversation_id: "conv-stale2",
        generation_id: "gen-stale2",
        user_email: "test@example.com"
      });

      const before = telemetry._testHooks.getActiveMapSizes().toolCalls;
      assert.ok(before >= 1, "at least one entry should exist after preToolUse");

      // Backdate entry to exceed TTL
      telemetry._testHooks.backdateToolCall("stale-sweep-test-2", 6 * 60 * 1000);

      telemetry.sweepStaleSpans();

      assert.equal(
        telemetry._testHooks.getActiveMapSizes().toolCalls,
        before - 1,
        "stale entry should be removed by sweep"
      );
    });

    it("sweepStaleSpans does not remove non-stale entries", () => {
      telemetry.recordHookEvent({
        hook_event_name: "preToolUse",
        tool_use_id: "fresh-entry-1",
        tool_name: "Write",
        conversation_id: "conv-fresh",
        generation_id: "gen-fresh",
        user_email: "test@example.com"
      });

      const before = telemetry._testHooks.getActiveMapSizes().toolCalls;
      // Do NOT backdate — entry is fresh
      telemetry.sweepStaleSpans();

      assert.equal(
        telemetry._testHooks.getActiveMapSizes().toolCalls,
        before,
        "fresh entry should survive sweep"
      );

      // Clean up
      telemetry.recordHookEvent({
        hook_event_name: "postToolUse",
        tool_use_id: "fresh-entry-1",
        tool_name: "Write",
        conversation_id: "conv-fresh",
        generation_id: "gen-fresh"
      });
    });

    it("subagentStart adds entry; stale sweep removes it when backdated", () => {
      telemetry.recordHookEvent({
        hook_event_name: "subagentStart",
        subagent_id: "stale-agent-1",
        subagent_type: "claude",
        conversation_id: "conv-agent-stale",
        generation_id: "gen-agent-stale",
        user_email: "test@example.com"
      });

      const before = telemetry._testHooks.getActiveMapSizes().subagents;
      assert.ok(before >= 1);

      telemetry._testHooks.backdateSubagent("stale-agent-1", 6 * 60 * 1000);
      telemetry.sweepStaleSpans();

      assert.equal(
        telemetry._testHooks.getActiveMapSizes().subagents,
        before - 1,
        "stale subagent span should be removed"
      );
    });
  });

  // ── MCP token double-counting fix ──────────────────────────────────────────

  describe("MCP token attribution (double-count fix)", () => {
    it("beforeMCPExecution + afterMCPExecution complete without error", () => {
      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "beforeMCPExecution",
          tool_use_id: "mcp-dc-1",
          tool_name: "mcp:search/query",
          url: "https://mcp.example.com/sse",
          tool_input: JSON.stringify({ query: "test search" }),
          conversation_id: "conv-mcp-dc",
          generation_id: "gen-mcp-dc",
          user_email: "test@example.com"
        });
      });

      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "afterMCPExecution",
          tool_use_id: "mcp-dc-1",
          tool_name: "mcp:search/query",
          url: "https://mcp.example.com/sse",
          tool_input: JSON.stringify({ query: "test search" }),
          result_json: JSON.stringify({ results: ["a", "b"], usage: { input_tokens: 20, output_tokens: 10 } }),
          duration: 180,
          conversation_id: "conv-mcp-dc",
          generation_id: "gen-mcp-dc"
        });
      });
    });

    it("afterMCPExecution with reported token usage completes without error", () => {
      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "afterMCPExecution",
          tool_use_id: "mcp-reported-1",
          tool_name: "mcp:anthropic/search",
          url: "https://mcp.anthropic.com/sse",
          tool_input: JSON.stringify({ q: "hello" }),
          result_json: JSON.stringify({ data: "result", usage: { input_tokens: 50, output_tokens: 25 } }),
          duration: 300,
          conversation_id: "conv-mcp-reported"
        });
      });
    });

    it("afterMCPExecution with error status marks failed without throw", () => {
      const result = telemetry.recordHookEvent({
        hook_event_name: "afterMCPExecution",
        tool_use_id: "mcp-fail-1",
        tool_name: "mcp:broken/tool",
        status: "error",
        duration: 50,
        conversation_id: "conv-mcp-fail"
      });
      assert.equal(result.shouldFlush, false);
    });
  });

  // ── shell exit code fix ────────────────────────────────────────────────────

  describe("shell exit code capture", () => {
    it("non-zero exit_code marks execution as failed without error", () => {
      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "beforeShellExecution",
          tool_use_id: "shell-fail-1",
          command: "npm test",
          conversation_id: "conv-shell",
          generation_id: "gen-shell",
          user_email: "test@example.com"
        });

        telemetry.recordHookEvent({
          hook_event_name: "afterShellExecution",
          tool_use_id: "shell-fail-1",
          command: "npm test",
          exit_code: 1,
          output: "1 test failed",
          duration_ms: 2000,
          conversation_id: "conv-shell",
          generation_id: "gen-shell"
        });
      });
    });

    it("zero exit_code marks execution as success without error", () => {
      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "beforeShellExecution",
          tool_use_id: "shell-ok-1",
          command: "git status",
          conversation_id: "conv-shell-ok",
          generation_id: "gen-shell-ok",
          user_email: "test@example.com"
        });

        telemetry.recordHookEvent({
          hook_event_name: "afterShellExecution",
          tool_use_id: "shell-ok-1",
          command: "git status",
          exit_code: 0,
          output: "nothing to commit",
          duration_ms: 50,
          conversation_id: "conv-shell-ok",
          generation_id: "gen-shell-ok"
        });
      });
    });

    it("missing exit_code (undefined) does not fail execution", () => {
      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "afterShellExecution",
          tool_use_id: "shell-no-code-1",
          command: "echo hello",
          output: "hello",
          duration_ms: 10,
          conversation_id: "conv-shell-no-code"
        });
      });
    });

    it("status=error takes precedence over missing exit_code", () => {
      assert.doesNotThrow(() => {
        telemetry.recordHookEvent({
          hook_event_name: "afterShellExecution",
          tool_use_id: "shell-status-err",
          command: "bad-command",
          status: "error",
          duration_ms: 5,
          conversation_id: "conv-shell-status-err"
        });
      });
    });
  });
});
