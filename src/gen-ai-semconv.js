import {
  ATTR_GEN_AI_AGENT_ID,
  ATTR_GEN_AI_AGENT_NAME,
  ATTR_GEN_AI_CONVERSATION_ID,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_OUTPUT_TYPE,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_ID,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_ID,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_TOOL_TYPE,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS,
  GEN_AI_OPERATION_NAME_VALUE_CREATE_AGENT,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT
} from "@opentelemetry/semantic-conventions/incubating";
import { redactForLogs } from "./privacy.js";
import {
  classifyInvocation,
  cliCommandLabel,
  parseToolPayload,
  resolveMcpServer,
  resolveMcpTool
} from "./attribution.js";

export const GEN_AI_PROVIDER_NAME = "cursor";
export const GEN_AI_CURSOR_AGENT_NAME = "Cursor";

const TOOL_PAYLOAD_MAX_LEN = Number(process.env.CURSOR_TOOL_PAYLOAD_MAX_LEN || 8192);

/** @param {string} agentName */
export function spanNameInvokeAgent(agentName) {
  const name = agentName?.trim();
  return name ? `${GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT} ${name}` : GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT;
}

/** @param {string} agentName */
export function spanNameCreateAgent(agentName) {
  const name = agentName?.trim();
  return name ? `${GEN_AI_OPERATION_NAME_VALUE_CREATE_AGENT} ${name}` : GEN_AI_OPERATION_NAME_VALUE_CREATE_AGENT;
}

/** @param {string} toolName */
export function spanNameExecuteTool(toolName) {
  const name = toolName?.trim();
  return name
    ? `${GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL} ${name}`
    : GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL;
}

/** @param {string} model */
export function spanNameChat(model) {
  const name = model?.trim();
  return name ? `chat ${name}` : "chat";
}

/**
 * @param {Record<string, unknown>} baseAttrs
 * @param {Record<string, unknown>} extra
 */
export function buildGenAiBaseAttributes(baseAttrs, extra = {}) {
  return filterDefined({
    [ATTR_GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_NAME,
    [ATTR_GEN_AI_CONVERSATION_ID]: baseAttrs[ATTR_GEN_AI_CONVERSATION_ID],
    [ATTR_GEN_AI_REQUEST_MODEL]: baseAttrs[ATTR_GEN_AI_REQUEST_MODEL],
    [ATTR_GEN_AI_RESPONSE_ID]: baseAttrs[ATTR_GEN_AI_RESPONSE_ID],
    "cursor.user": baseAttrs["cursor.user"],
    "cursor.user.email": baseAttrs["cursor.user.email"],
    "cursor.repo": baseAttrs["cursor.repo"],
    ...extra
  });
}

/**
 * @param {Record<string, unknown>} baseAttrs
 * @param {{ agentName: string, agentId?: string, operationName?: string }} options
 */
export function buildInvokeAgentAttributes(baseAttrs, { agentName, agentId, operationName }) {
  return buildGenAiBaseAttributes(baseAttrs, {
    [ATTR_GEN_AI_OPERATION_NAME]: operationName || GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT,
    [ATTR_GEN_AI_AGENT_NAME]: agentName,
    [ATTR_GEN_AI_AGENT_ID]: agentId,
    [ATTR_GEN_AI_OUTPUT_TYPE]: "text"
  });
}

/**
 * @param {Record<string, unknown>} baseAttrs
 * @param {import("./attribution.js").ReturnType<classifyInvocation>} attribution
 * @param {Record<string, unknown>} hookData
 * @param {string} [toolNameOverride]
 */
export function resolveExecuteToolContext(hookData, hookName, toolNameOverride) {
  const attribution = classifyInvocation(hookName, hookData, toolNameOverride);
  const mcpServer = attribution.category === "mcp" ? resolveMcpServer(hookData) : undefined;
  const mcpTool = attribution.category === "mcp" ? resolveMcpTool(hookData) : undefined;

  let genAiToolName =
    toolNameOverride ||
    (typeof hookData.tool_name === "string" ? hookData.tool_name : undefined) ||
    (typeof hookData.mcp_tool_name === "string" ? hookData.mcp_tool_name : undefined) ||
    "unknown";

  if (attribution.category === "mcp" && mcpTool) {
    genAiToolName = mcpTool;
  } else if (attribution.category === "cli") {
    genAiToolName = cliCommandLabel(hookData.command);
  } else if (attribution.category === "skill") {
    genAiToolName = `skill:${attribution.name}`;
  } else if (genAiToolName.startsWith("mcp:")) {
    const slash = genAiToolName.indexOf("/");
    genAiToolName = slash >= 0 ? genAiToolName.slice(slash + 1) : genAiToolName.replace(/^mcp:/i, "");
  }

  return {
    genAiToolName,
    toolType: inferGenAiToolType(attribution, genAiToolName, hookData),
    attribution,
    mcpServer,
    mcpTool,
    serverAddress: mcpServer && mcpServer !== "unknown" ? mcpServer : undefined
  };
}

/**
 * @param {{ category: string }} attribution
 * @param {string} toolName
 * @param {Record<string, unknown>} hookData
 */
function inferGenAiToolType(attribution, toolName, hookData) {
  if (attribution.category === "mcp") {
    return "extension";
  }
  if (attribution.category === "skill") {
    return "function";
  }
  if (attribution.category === "cli") {
    return "function";
  }
  const lower = toolName.toLowerCase();
  if (lower === "read_file" || lower === "read" || lower === "grep" || lower === "glob") {
    return "datastore";
  }
  if (hookData.file_path) {
    return "datastore";
  }
  return "function";
}

/**
 * @param {Record<string, unknown>} baseAttrs
 * @param {ReturnType<resolveExecuteToolContext>} toolContext
 * @param {Record<string, unknown>} hookData
 * @param {{ includePayloads?: boolean }} [options]
 */
export function buildExecuteToolAttributes(baseAttrs, toolContext, hookData, { includePayloads = false } = {}) {
  const attrs = buildGenAiBaseAttributes(baseAttrs, {
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
    [ATTR_GEN_AI_TOOL_NAME]: toolContext.genAiToolName,
    [ATTR_GEN_AI_TOOL_TYPE]: toolContext.toolType,
    [ATTR_GEN_AI_TOOL_CALL_ID]: hookData.tool_use_id,
    "server.address": toolContext.serverAddress,
    "cursor.attribution.category": toolContext.attribution.category,
    "cursor.attribution.name": toolContext.attribution.name,
    "cursor.attribution.detail": toolContext.attribution.detail
  });

  if (toolContext.mcpServer) {
    attrs["cursor.mcp.server"] = toolContext.mcpServer;
  }
  if (toolContext.mcpTool) {
    attrs["cursor.mcp.tool"] = toolContext.mcpTool;
  }

  if (includePayloads) {
    const args = toolPayloadForSpan(hookData.tool_input);
    const result = toolPayloadForSpan(hookData.tool_output ?? hookData.result_json);
    if (args !== undefined) {
      attrs[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS] = args;
    }
    if (result !== undefined) {
      attrs[ATTR_GEN_AI_TOOL_CALL_RESULT] = result;
    }
  }

  return attrs;
}

/** @param {{ input?: number, output?: number }} tokenEstimate */
export function buildUsageTokenAttributes(tokenEstimate) {
  if (!tokenEstimate) {
    return {};
  }
  return filterDefined({
    [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: tokenEstimate.input > 0 ? tokenEstimate.input : undefined,
    [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: tokenEstimate.output > 0 ? tokenEstimate.output : undefined
  });
}

/** @param {unknown} reasoningText */
export function buildReasoningUsageAttributes(reasoningText) {
  const tokens = estimateReasoningTokens(reasoningText);
  if (!tokens) {
    return {};
  }
  return { [ATTR_GEN_AI_USAGE_REASONING_OUTPUT_TOKENS]: tokens };
}

/** @param {unknown} value */
function toolPayloadForSpan(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = parseToolPayload(value);
  const redacted = redactForLogs(parsed ?? value, { includeToolDetails: true });
  const serialized =
    typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  if (serialized.length <= TOOL_PAYLOAD_MAX_LEN) {
    return typeof redacted === "object" ? redacted : serialized;
  }
  return `${serialized.slice(0, TOOL_PAYLOAD_MAX_LEN)}…`;
}

/** @param {unknown} text */
function estimateReasoningTokens(text) {
  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }
  return Math.ceil(text.length / 4);
}

/** @param {Record<string, unknown>} attrs */
function filterDefined(attrs) {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}
