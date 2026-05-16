const SKILL_PATH_RE = /(?:^|[/\\])skills[/\\]|SKILL\.md$/i;
const MCP_TOOL_PREFIX_RE = /^mcp:\s*/i;
const MCP_MATCHER_RE = /^MCP:\s*([^/]+)\/(.+)$/i;

/** @param {unknown} value */
export function parseToolPayload(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return { _raw: value };
  }
}

/** @param {unknown} value */
export function estimateTokens(value) {
  if (value === undefined || value === null) {
    return 0;
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text.length) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/** @param {Record<string, unknown>} hookData */
export function resolveMcpServer(hookData) {
  if (hookData.mcp_server) {
    return String(hookData.mcp_server);
  }

  if (typeof hookData.url === "string" && hookData.url) {
    try {
      const host = new URL(hookData.url).hostname;
      if (host) {
        return host;
      }
    } catch {
      return hookData.url;
    }
  }

  if (typeof hookData.command === "string" && hookData.command.trim()) {
    return hookData.command.trim().split(/\s+/)[0];
  }

  const toolName = String(hookData.mcp_tool_name || hookData.tool_name || "");
  const matcher = toolName.match(MCP_MATCHER_RE);
  if (matcher) {
    return matcher[1];
  }

  if (MCP_TOOL_PREFIX_RE.test(toolName)) {
    return toolName.replace(MCP_TOOL_PREFIX_RE, "").split("/")[0] || "mcp";
  }

  return "unknown";
}

/** @param {Record<string, unknown>} hookData */
export function resolveMcpTool(hookData) {
  const toolName = String(hookData.mcp_tool_name || hookData.tool_name || "unknown");
  const matcher = toolName.match(MCP_MATCHER_RE);
  if (matcher) {
    return matcher[2];
  }
  if (MCP_TOOL_PREFIX_RE.test(toolName)) {
    const rest = toolName.replace(MCP_TOOL_PREFIX_RE, "");
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : rest;
  }
  return toolName;
}

/** @param {unknown} filePath */
export function skillNameFromPath(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    return undefined;
  }
  if (!SKILL_PATH_RE.test(filePath)) {
    return undefined;
  }
  const parts = filePath.split(/[/\\]/);
  const skillsIdx = parts.findIndex((p) => p.toLowerCase() === "skills");
  if (skillsIdx >= 0 && parts[skillsIdx + 1]) {
    return parts[skillsIdx + 1];
  }
  if (parts.at(-1)?.toUpperCase() === "SKILL.MD" && parts.length >= 2) {
    return parts.at(-2);
  }
  return "skill";
}

/** @param {unknown} command */
export function cliCommandLabel(command) {
  if (typeof command !== "string" || !command.trim()) {
    return "shell";
  }
  const trimmed = command.trim();
  const first = trimmed.split(/\s+/)[0];
  const base = first.includes("/") ? first.split("/").pop() : first;
  return base || "shell";
}

/** @param {unknown} resultJson */
export function extractReportedTokenUsage(resultJson) {
  const parsed = parseToolPayload(resultJson);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidates = [
    parsed,
    /** @type {Record<string, unknown>} */ (parsed).usage,
    /** @type {Record<string, unknown>} */ (parsed).token_usage,
    /** @type {Record<string, unknown>} */ (parsed).tokens
  ].filter(Boolean);

  for (const usage of candidates) {
    if (!usage || typeof usage !== "object") {
      continue;
    }
    const input =
      numberOrZero(usage.input_tokens) ||
      numberOrZero(usage.prompt_tokens) ||
      numberOrZero(usage.input);
    const output =
      numberOrZero(usage.output_tokens) ||
      numberOrZero(usage.completion_tokens) ||
      numberOrZero(usage.output);
    const total = numberOrZero(usage.total_tokens) || numberOrZero(usage.total);
    if (input || output || total) {
      return {
        input: input || (total && !output ? total : 0),
        output: output || 0,
        total: total || input + output
      };
    }
  }

  return null;
}

/** @param {unknown} n */
function numberOrZero(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Classify who consumed/produced context for attribution metrics.
 * @param {string} hookName
 * @param {Record<string, unknown>} hookData
 * @param {string} [toolNameOverride]
 */
export function classifyInvocation(hookName, hookData, toolNameOverride) {
  const toolName = toolNameOverride || String(hookData.tool_name || hookData.toolName || "");

  if (
    hookName === "beforeMCPExecution" ||
    hookName === "afterMCPExecution" ||
    MCP_TOOL_PREFIX_RE.test(toolName) ||
    MCP_MATCHER_RE.test(toolName)
  ) {
    return {
      category: "mcp",
      name: resolveMcpServer(hookData),
      detail: resolveMcpTool(hookData),
      operationName: "execute_tool"
    };
  }

  if (hookName === "beforeShellExecution" || hookName === "afterShellExecution") {
    return {
      category: "cli",
      name: cliCommandLabel(hookData.command),
      detail: typeof hookData.command === "string" ? hookData.command.slice(0, 128) : undefined,
      operationName: "execute_tool"
    };
  }

  const skillFromFile = skillNameFromPath(hookData.file_path);
  if (skillFromFile) {
    return {
      category: "skill",
      name: skillFromFile,
      detail: "file",
      operationName: "execute_tool"
    };
  }

  const input = parseToolPayload(hookData.tool_input);
  if (input && typeof input === "object") {
    const subagentType = input.subagent_type || input.agent_type;
    if (typeof subagentType === "string" && subagentType) {
      const isSkill = /skill/i.test(subagentType) || SKILL_PATH_RE.test(String(input.prompt || ""));
      return {
        category: isSkill ? "skill" : "subagent",
        name: subagentType,
        detail: input.description ? String(input.description).slice(0, 64) : undefined,
        operationName: "create_agent"
      };
    }
  }

  if (hookData.subagent_type) {
    const subagentType = String(hookData.subagent_type);
    return {
      category: /skill/i.test(subagentType) ? "skill" : "subagent",
      name: subagentType,
      operationName: "invoke_agent"
    };
  }

  const lowerTool = toolName.toLowerCase();
  if (lowerTool === "task" || lowerTool.includes("subagent")) {
    return {
      category: "subagent",
      name: toolName,
      operationName: "create_agent"
    };
  }

  if (typeof hookData.command === "string" && SKILL_PATH_RE.test(hookData.command)) {
    return {
      category: "skill",
      name: skillNameFromPath(hookData.command) || "skill-invoke",
      detail: "shell",
      operationName: "execute_tool"
    };
  }

  return {
    category: "tool",
    name: toolName || "unknown",
    operationName: "execute_tool"
  };
}

/** @param {Record<string, unknown>} hookData */
export function estimateMcpContextTokens(hookData) {
  const reported = extractReportedTokenUsage(hookData.result_json);
  if (reported) {
    return {
      input: reported.input,
      output: reported.output,
      source: "mcp_reported"
    };
  }

  return {
    input: estimateTokens(hookData.tool_input),
    output: estimateTokens(hookData.result_json),
    source: "estimated"
  };
}

/** @param {Record<string, unknown>} hookData */
export function estimateShellContextTokens(hookData) {
  return {
    input: estimateTokens(hookData.command),
    output: estimateTokens(hookData.output),
    source: "estimated"
  };
}

/** @param {unknown} raw */
function estimateParsedPayloadTokens(raw) {
  const parsed = parseToolPayload(raw);
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "_raw" in parsed &&
    Object.keys(parsed).length === 1
  ) {
    return estimateTokens(parsed._raw);
  }
  return estimateTokens(parsed ?? raw);
}

/** @param {Record<string, unknown>} hookData */
export function estimateToolContextTokens(hookData) {
  return {
    input: estimateParsedPayloadTokens(hookData.tool_input),
    output: estimateParsedPayloadTokens(hookData.tool_output),
    source: "estimated"
  };
}
