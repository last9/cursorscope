import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyInvocation,
  cliCommandLabel,
  estimateMcpContextTokens,
  estimateShellContextTokens,
  estimateTokens,
  estimateToolContextTokens,
  extractReportedTokenUsage,
  parseToolPayload,
  resolveMcpServer,
  resolveMcpTool,
  skillNameFromPath
} from "../src/attribution.js";

describe("attribution", () => {
  describe("parseToolPayload", () => {
    it("parses JSON strings and passes through objects", () => {
      assert.deepEqual(parseToolPayload('{"a":1}'), { a: 1 });
      assert.deepEqual(parseToolPayload({ b: 2 }), { b: 2 });
      assert.equal(parseToolPayload(""), null);
    });

    it("wraps invalid JSON as _raw", () => {
      assert.deepEqual(parseToolPayload("not-json"), { _raw: "not-json" });
    });
  });

  describe("estimateTokens", () => {
    it("estimates tokens as ceil(length / 4)", () => {
      assert.equal(estimateTokens("abcd"), 1);
      assert.equal(estimateTokens("a".repeat(9)), 3);
      assert.equal(estimateTokens(null), 0);
    });
  });

  describe("resolveMcpServer", () => {
    it("uses explicit mcp_server when set", () => {
      assert.equal(resolveMcpServer({ mcp_server: "linear" }), "linear");
    });

    it("extracts host from url", () => {
      assert.equal(
        resolveMcpServer({ url: "https://mcp.linear.app/sse", tool_name: "list" }),
        "mcp.linear.app"
      );
    });

    it("parses MCP: server/tool matcher format", () => {
      assert.equal(
        resolveMcpServer({ tool_name: "MCP: plugin-linear/list_issues" }),
        "plugin-linear"
      );
    });
  });

  describe("resolveMcpTool", () => {
    it("extracts tool from MCP matcher", () => {
      assert.equal(resolveMcpTool({ tool_name: "MCP: srv/search" }), "search");
    });

    it("extracts tool from mcp: prefix", () => {
      assert.equal(resolveMcpTool({ tool_name: "mcp:host/tool" }), "tool");
    });
  });

  describe("skillNameFromPath", () => {
    it("detects skill directory names", () => {
      assert.equal(
        skillNameFromPath("/Users/x/.cursor/skills-cursor/canvas/SKILL.md"),
        "canvas"
      );
    });

    it("returns undefined for non-skill paths", () => {
      assert.equal(skillNameFromPath("/tmp/foo.ts"), undefined);
    });
  });

  describe("cliCommandLabel", () => {
    it("returns first command segment", () => {
      assert.equal(cliCommandLabel("npm test"), "npm");
      assert.equal(cliCommandLabel("/usr/bin/git status"), "git");
      assert.equal(cliCommandLabel(""), "shell");
    });
  });

  describe("extractReportedTokenUsage", () => {
    it("reads usage blocks from MCP result_json", () => {
      const usage = extractReportedTokenUsage(
        JSON.stringify({ usage: { input_tokens: 100, output_tokens: 50 } })
      );
      assert.deepEqual(usage, { input: 100, output: 50, total: 150 });
    });

    it("supports total_tokens only", () => {
      const usage = extractReportedTokenUsage(JSON.stringify({ usage: { total_tokens: 99 } }));
      assert.deepEqual(usage, { input: 99, output: 0, total: 99 });
    });

    it("returns null when no usage present", () => {
      assert.equal(extractReportedTokenUsage('{"ok":true}'), null);
    });
  });

  describe("classifyInvocation", () => {
    it("classifies MCP hooks", () => {
      const result = classifyInvocation("afterMCPExecution", {
        url: "http://localhost:3000",
        tool_name: "search"
      });
      assert.equal(result.category, "mcp");
      assert.equal(result.name, "localhost");
      assert.equal(result.detail, "search");
    });

    it("classifies shell hooks", () => {
      const result = classifyInvocation("afterShellExecution", {
        command: "curl https://example.com"
      });
      assert.equal(result.category, "cli");
      assert.equal(result.name, "curl");
    });

    it("classifies skill file reads", () => {
      const result = classifyInvocation("beforeReadFile", {
        file_path: "/proj/.cursor/skills/foo/SKILL.md"
      });
      assert.equal(result.category, "skill");
      assert.equal(result.name, "foo");
    });

    it("classifies subagent from hook data", () => {
      const result = classifyInvocation("subagentStart", {
        subagent_type: "explore"
      });
      assert.equal(result.category, "subagent");
      assert.equal(result.name, "explore");
    });
  });

  describe("context token estimates", () => {
    it("prefers MCP-reported usage", () => {
      const tokens = estimateMcpContextTokens({
        tool_input: '{"q":"x"}',
        result_json: JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } })
      });
      assert.deepEqual(tokens, { input: 10, output: 5, source: "mcp_reported" });
    });

    it("estimates shell and tool payloads", () => {
      const shell = estimateShellContextTokens({ command: "ls", output: "a\nb\nc\nd" });
      assert.equal(shell.source, "estimated");
      assert.equal(shell.input, 1);
      assert.equal(shell.output, 2);

      const tool = estimateToolContextTokens({
        tool_input: "12345678",
        tool_output: "abcd"
      });
      assert.equal(tool.input, 2);
      assert.equal(tool.output, 1);
    });
  });
});
