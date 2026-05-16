import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_TOOL_TYPE,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT
} from "@opentelemetry/semantic-conventions/incubating";
import {
  buildExecuteToolAttributes,
  buildInvokeAgentAttributes,
  buildReasoningUsageAttributes,
  buildUsageTokenAttributes,
  GEN_AI_CURSOR_AGENT_NAME,
  GEN_AI_PROVIDER_NAME,
  resolveExecuteToolContext,
  spanNameExecuteTool,
  spanNameInvokeAgent
} from "../src/gen-ai-semconv.js";

const baseAttrs = {
  [ATTR_GEN_AI_REQUEST_MODEL]: "claude-sonnet-4-20250514",
  "gen_ai.conversation.id": "conv-1"
};

describe("gen-ai-semconv", () => {
  describe("span names", () => {
    it("follows OTel GenAI naming", () => {
      assert.equal(spanNameInvokeAgent("Cursor"), `${GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT} Cursor`);
      assert.equal(spanNameInvokeAgent(""), GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT);
      assert.equal(spanNameExecuteTool("search"), `${GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL} search`);
    });
  });

  describe("buildInvokeAgentAttributes", () => {
    it("sets required invoke_agent fields", () => {
      const attrs = buildInvokeAgentAttributes(baseAttrs, {
        agentName: GEN_AI_CURSOR_AGENT_NAME,
        agentId: "agent-1"
      });
      assert.equal(attrs[ATTR_GEN_AI_OPERATION_NAME], GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT);
      assert.equal(attrs["gen_ai.agent.name"], GEN_AI_CURSOR_AGENT_NAME);
      assert.equal(attrs["gen_ai.agent.id"], "agent-1");
      assert.equal(attrs["gen_ai.provider.name"], GEN_AI_PROVIDER_NAME);
    });
  });

  describe("resolveExecuteToolContext", () => {
    it("uses MCP tool name without server prefix", () => {
      const ctx = resolveExecuteToolContext(
        {
          url: "https://mcp.example.com",
          tool_name: "search",
          mcp_server: "mcp.example.com",
          mcp_tool: "search"
        },
        "afterMCPExecution"
      );
      assert.equal(ctx.genAiToolName, "search");
      assert.equal(ctx.toolType, "extension");
      assert.equal(ctx.serverAddress, "mcp.example.com");
      assert.equal(ctx.attribution.category, "mcp");
    });

    it("labels CLI and skill invocations", () => {
      const cli = resolveExecuteToolContext(
        { command: "npm test" },
        "afterShellExecution",
        "shell"
      );
      assert.equal(cli.genAiToolName, "npm");
      assert.equal(cli.toolType, "function");

      const skill = resolveExecuteToolContext(
        { file_path: "/x/skills/my-skill/SKILL.md" },
        "beforeReadFile",
        "read_file"
      );
      assert.equal(skill.genAiToolName, "skill:my-skill");
    });
  });

  describe("buildExecuteToolAttributes", () => {
    it("sets execute_tool semconv attributes", () => {
      const hookData = { tool_use_id: "tc-1", tool_input: '{"q":"x"}' };
      const ctx = resolveExecuteToolContext(
        { url: "https://mcp.example.com", tool_name: "search" },
        "afterMCPExecution"
      );
      const attrs = buildExecuteToolAttributes(baseAttrs, ctx, hookData);
      assert.equal(attrs[ATTR_GEN_AI_OPERATION_NAME], GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL);
      assert.equal(attrs[ATTR_GEN_AI_TOOL_NAME], "search");
      assert.equal(attrs[ATTR_GEN_AI_TOOL_TYPE], "extension");
      assert.equal(attrs["gen_ai.tool.call.id"], "tc-1");
      assert.equal(attrs["cursor.mcp.server"], "mcp.example.com");
    });
  });

  describe("usage attributes", () => {
    it("maps token estimates to gen_ai.usage.*", () => {
      const attrs = buildUsageTokenAttributes({ input: 100, output: 50 });
      assert.equal(attrs[ATTR_GEN_AI_USAGE_INPUT_TOKENS], 100);
      assert.equal(attrs["gen_ai.usage.output_tokens"], 50);
    });

    it("estimates reasoning output tokens", () => {
      const attrs = buildReasoningUsageAttributes("12345678");
      assert.equal(attrs["gen_ai.usage.reasoning.output_tokens"], 2);
    });
  });
});
