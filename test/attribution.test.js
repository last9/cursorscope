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
  requestedSkillNames,
  resolveMcpServer,
  resolveMcpTool,
  skillInvocationTrigger,
  skillManifestPathFromInput,
  skillNameFromPath,
  skillSourceFromPath
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

    it("classifies a Read tool call that opens a SKILL.md in tool_input", () => {
      const result = classifyInvocation("postToolUse", {
        tool_name: "Read",
        tool_input: { file_path: "/Users/x/.cursor/skills-cursor/share/SKILL.md" }
      });
      assert.equal(result.category, "skill");
      assert.equal(result.name, "share");
      assert.equal(result.filePath, "/Users/x/.cursor/skills-cursor/share/SKILL.md");
    });

    it("does not classify a Write to a SKILL.md as a skill activation", () => {
      const result = classifyInvocation("postToolUse", {
        tool_name: "Write",
        tool_input: { file_path: "/proj/.cursor/skills/foo/SKILL.md" }
      });
      assert.equal(result.category, "tool");
    });

    it("does not classify a Read of another file in a skill folder as an activation", () => {
      const result = classifyInvocation("postToolUse", {
        tool_name: "Read",
        tool_input: { file_path: "/proj/.cursor/skills/foo/scripts/run.js" }
      });
      assert.equal(result.category, "tool");
    });

    it("classifies subagent from hook data", () => {
      const result = classifyInvocation("subagentStart", {
        subagent_type: "explore"
      });
      assert.equal(result.category, "subagent");
      assert.equal(result.name, "explore");
    });
  });

  describe("skillManifestPathFromInput", () => {
    it("reads file_path, path, and target_file from object or JSON string input", () => {
      assert.equal(skillManifestPathFromInput("Read", { path: "/a/skills/x/SKILL.md" }), "/a/skills/x/SKILL.md");
      assert.equal(
        skillManifestPathFromInput("read_file", JSON.stringify({ target_file: "/a/x/SKILL.md" })),
        "/a/x/SKILL.md"
      );
    });

    it("ignores tools that do not read files", () => {
      assert.equal(skillManifestPathFromInput("Grep", { path: "/a/x/SKILL.md" }), undefined);
    });
  });

  describe("skillSourceFromPath", () => {
    const options = { workspaceRoots: ["/work/repo"], homeDir: "/home/me" };

    it("maps paths to the skill.source values of Claude Code", () => {
      assert.equal(skillSourceFromPath("/home/me/.cursor/skills-cursor/share/SKILL.md", options), "bundled");
      assert.equal(
        skillSourceFromPath("/home/me/.cursor/plugins/cache/p/skills/a/SKILL.md", options),
        "plugin"
      );
      assert.equal(skillSourceFromPath("/work/repo/.claude/skills/a/SKILL.md", options), "projectSettings");
      assert.equal(skillSourceFromPath("/home/me/.cursor/skills/a/SKILL.md", options), "userSettings");
      assert.equal(skillSourceFromPath("/elsewhere/skills/a/SKILL.md", options), undefined);
    });

    it("prefers projectSettings when the workspace is inside the home directory", () => {
      assert.equal(
        skillSourceFromPath("/home/me/repo/.cursor/skills/a/SKILL.md", {
          workspaceRoots: ["/home/me/repo"],
          homeDir: "/home/me"
        }),
        "projectSettings"
      );
    });
  });

  describe("requestedSkillNames and skillInvocationTrigger", () => {
    it("collects slash mentions and attached SKILL.md files", () => {
      const names = requestedSkillNames("please run /Share and then /loop 5m", [
        { type: "file", file_path: "/a/skills/Canvas/SKILL.md" },
        { type: "file", file_path: "/a/src/index.js" }
      ]);
      assert.deepEqual([...names].sort(), ["canvas", "loop", "share"]);
    });

    it("does not treat a path in the middle of a word as a slash mention", () => {
      assert.equal(requestedSkillNames("see src/share/index.js", []).size, 0);
    });

    it("returns user-slash when the user asked for the skill and agent-proactive otherwise", () => {
      const requested = requestedSkillNames("/share my work", []);
      assert.equal(skillInvocationTrigger("share", requested), "user-slash");
      assert.equal(skillInvocationTrigger("loop", requested), "agent-proactive");
      assert.equal(skillInvocationTrigger("loop", undefined), "agent-proactive");
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
