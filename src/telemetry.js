import "./env.js";
import { context, metrics, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { maskEmail, redactForLogs, redactSensitiveText } from "./privacy.js";
import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { wrapExporterWithLogging } from "./otel-export-logger.js";
import { getConfiguredOtlpEndpoints } from "./otlp-endpoints.js";
import {
  basenameOnly,
  extractFileLineStats,
  inferFileExtension
} from "./line-stats.js";
import {
  classifyInvocation,
  estimateMcpContextTokens,
  estimateShellContextTokens,
  estimateToolContextTokens,
  estimateTokens,
  resolveMcpServer,
  resolveMcpTool
} from "./attribution.js";
import {
  ATTR_GEN_AI_CONVERSATION_ID,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_OUTPUT_TYPE,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_ID,
  ATTR_GEN_AI_TOOL_CALL_ID,
  ATTR_GEN_AI_TOOL_NAME,
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
  spanNameChat,
  spanNameExecuteTool,
  spanNameInvokeAgent
} from "./gen-ai-semconv.js";
const logUserPrompts = process.env.CURSOR_LOG_USER_PROMPTS === "true";
const logToolDetails = process.env.CURSOR_LOG_TOOL_DETAILS === "true";
const maskUserEmail = process.env.CURSOR_MASK_USER_EMAIL === "true";
const trackAttributedTokens = process.env.CURSOR_TRACK_ATTRIBUTED_TOKENS !== "false";
const flushOnStop = process.env.CURSOR_FLUSH_ON_STOP !== "false";
const metricExportIntervalMs = Number(process.env.METRIC_EXPORT_INTERVAL_MS || 15000);

const serviceName = process.env.OTEL_SERVICE_NAME || "cursorscope";
const resource = resourceFromAttributes({
  [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  [SemanticResourceAttributes.SERVICE_NAMESPACE]:
    process.env.OTEL_SERVICE_NAMESPACE || "cursorscope",
  [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || "0.2.0",
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
    process.env.DEPLOYMENT_ENVIRONMENT || "local"
});

const { traces: tracesEndpoint, metrics: metricsEndpoint, logs: logsEndpoint } =
  getConfiguredOtlpEndpoints();
const otlpHeaders = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);

const traceExporter = wrapExporterWithLogging(
  new OTLPTraceExporter({ url: tracesEndpoint, headers: otlpHeaders }),
  "traces",
  tracesEndpoint
);

const metricExporter = wrapExporterWithLogging(
  new OTLPMetricExporter({ url: metricsEndpoint, headers: otlpHeaders }),
  "metrics",
  metricsEndpoint
);

const logExporter = wrapExporterWithLogging(
  new OTLPLogExporter({ url: logsEndpoint, headers: otlpHeaders }),
  "logs",
  logsEndpoint
);

const tracerProvider = new BasicTracerProvider({
  resource,
  spanProcessors: [new BatchSpanProcessor(traceExporter)]
});
trace.setGlobalTracerProvider(tracerProvider);

const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: metricExportIntervalMs,
      exportTimeoutMillis: metricExportIntervalMs
    })
  ]
});
metrics.setGlobalMeterProvider(meterProvider);

const loggerProvider = new LoggerProvider({
  resource,
  processors: [new BatchLogRecordProcessor(logExporter)]
});
logs.setGlobalLoggerProvider(loggerProvider);

const tracer = trace.getTracer("cursorscope");
const meter = meterProvider.getMeter("cursorscope");
const logger = logs.getLogger("cursorscope");

const hookEventCounter = meter.createCounter("cursor_hook_events_total", {
  description: "Cursor hook events received"
});
const sessionCounter = meter.createCounter("cursor_session_total", {
  description: "Cursor composer sessions started"
});
const promptCounter = meter.createCounter("cursor_prompt_total", {
  description: "User prompts submitted in Cursor"
});
const toolCounter = meter.createCounter("cursor_tool_executions_total", {
  description: "Cursor tool executions (companion to gen_ai.client.operation.duration)"
});
const linesOfCodeCounter = meter.createCounter("cursor_lines_of_code_total", {
  description: "Lines of code added or removed by Cursor agent and Tab edits"
});
const mcpInvocationCounter = meter.createCounter("cursor_mcp_invocations_total", {
  description: "MCP tool invocations by server and tool name"
});
const attributionInvocationCounter = meter.createCounter("cursor_attribution_invocations_total", {
  description: "Invocations attributed to MCP servers, CLIs, skills, subagents, or tools"
});
const attributedContextTokensCounter = meter.createCounter("cursor_attributed_context_tokens_total", {
  description:
    "Estimated or MCP-reported context tokens flowing through MCP, CLI, skills, and tools (not Cursor LLM billing)"
});

const genAiOperationDuration = meter.createHistogram("gen_ai.client.operation.duration", {
  description: "GenAI operation duration per OTel semconv",
  unit: "s"
});
const genAiTokenUsage = meter.createHistogram("gen_ai.client.token.usage", {
  description: "GenAI token usage per OTel semconv",
  unit: "{token}"
});

const cursorApiMetricGauge = meter.createObservableGauge("cursor_api_metric_value", {
  description: "Numeric Cursor Admin API values",
  unit: "1"
});

const apiGaugeStore = new Map();
cursorApiMetricGauge.addCallback((result) => {
  for (const [key, entry] of apiGaugeStore.entries()) {
    result.observe(entry.value, entry.attributes);
    if (entry.ttlEpochMs < Date.now()) {
      apiGaugeStore.delete(key);
    }
  }
});

/** @type {Map<string, { span: import('@opentelemetry/api').Span, ctx: import('@opentelemetry/api').Context, conversationId?: string }>} */
const activeInteractions = new Map();
/** @type {Map<string, string>} */
const openGenerationByConversation = new Map();
/** @type {Map<string, { span: import('@opentelemetry/api').Span, ctx: import('@opentelemetry/api').Context }>} */
const activeSubagents = new Map();
/** @type {Map<string, { span: import('@opentelemetry/api').Span, ctx: import('@opentelemetry/api').Context }>} */
const activeSessions = new Map();
/** @type {Map<string, { span: import('@opentelemetry/api').Span, ctx: import('@opentelemetry/api').Context, startHrTime: number }>} */
const activeToolCalls = new Map();

function endSession(sessionId, reason) {
  if (!sessionId) {
    return;
  }
  const active = activeSessions.get(sessionId);
  if (!active) {
    return;
  }
  active.span.setAttribute("cursor.session.end_reason", reason);
  active.span.end();
  activeSessions.delete(sessionId);
}

function resolveToolName(hookData, fallback = "unknown") {
  const raw =
    hookData.tool_name ??
    hookData.toolName ??
    hookData.command ??
    hookData.mcp_tool_name ??
    hookData.name;

  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (typeof raw === "string") {
    return raw.trim() || fallback;
  }
  if (typeof raw === "object") {
    const nested = raw.name ?? raw.tool ?? raw.command;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }
  return String(raw);
}

/** @returns {{ shouldFlush: boolean }} */
export function recordHookEvent(event) {
  const safeEvent = sanitizeEvent(event);
  const hookData = safeEvent.data && typeof safeEvent.data === "object" ? safeEvent.data : safeEvent;
  const hookName = normalizeHookName(
    hookData.hook_event_name || safeEvent.hook_event_name || safeEvent.event_name
  );

  const baseAttrs = buildBaseAttributes(safeEvent, hookData);
  incrementHookCounter(hookName, baseAttrs);

  switch (hookName) {
    case "sessionStart":
      handleSessionStart(hookData, baseAttrs);
      break;
    case "sessionEnd":
      handleSessionEnd(hookData, baseAttrs);
      break;
    case "beforeSubmitPrompt":
      handleBeforeSubmitPrompt(hookData, baseAttrs);
      break;
    case "preToolUse":
      handlePreToolUse(hookData, baseAttrs);
      break;
    case "postToolUse":
      handlePostToolUse(hookData, baseAttrs, { failed: false });
      break;
    case "postToolUseFailure":
      handlePostToolUse(hookData, baseAttrs, { failed: true });
      break;
    case "beforeShellExecution":
      handleBeforeShellExecution(hookData, baseAttrs);
      break;
    case "afterShellExecution":
      handleAfterShellExecution(hookData, baseAttrs);
      break;
    case "beforeMCPExecution":
      handleBeforeMcpExecution(hookData, baseAttrs);
      break;
    case "afterMCPExecution":
      handleAfterMcpExecution(hookData, baseAttrs);
      break;
    case "beforeReadFile":
      handleBeforeReadFile(hookData, baseAttrs);
      break;
    case "afterFileEdit":
      handleAfterFileEdit(hookData, baseAttrs);
      break;
    case "afterTabFileEdit":
      handleAfterTabFileEdit(hookData, baseAttrs);
      break;
    case "subagentStart":
      handleSubagentStart(hookData, baseAttrs);
      break;
    case "subagentStop":
      handleSubagentStop(hookData, baseAttrs);
      break;
    case "afterAgentResponse":
      handleAfterAgentResponse(hookData, baseAttrs);
      break;
    case "afterAgentThought":
      handleAfterAgentThought(hookData, baseAttrs);
      break;
    case "stop":
      handleStop(hookData, baseAttrs);
      break;
    case "preCompact":
      handlePreCompact(hookData, baseAttrs);
      break;
    default:
      recordGenericHook(hookName, hookData, baseAttrs);
  }

  emitHookLog(hookName, hookData, baseAttrs);

  const shouldFlush =
    flushOnStop && (hookName === "stop" || hookName === "sessionEnd");
  return { shouldFlush };
}

function handleSessionStart(hookData, baseAttrs) {
  sessionCounter.add(1, legacyMetricLabels(baseAttrs, { composer_mode: hookData.composer_mode || "unknown" }));

  const sessionId = hookData.session_id || hookData.conversation_id;
  if (sessionId && activeSessions.has(sessionId)) {
    endSession(sessionId, "superseded");
  }

  const span = startSpan(
    spanNameInvokeAgent(GEN_AI_CURSOR_AGENT_NAME),
    {
      ...buildInvokeAgentAttributes(baseAttrs, { agentName: GEN_AI_CURSOR_AGENT_NAME }),
      "cursor.composer_mode": hookData.composer_mode,
      "cursor.is_background_agent": hookData.is_background_agent ?? false,
      "cursor.span.role": "session"
    },
    context.active(),
    SpanKind.INTERNAL
  );

  if (sessionId) {
    const ctx = trace.setSpan(context.active(), span);
    activeSessions.set(sessionId, { span, ctx });
  } else {
    span.end();
  }
}

function handleSessionEnd(hookData, baseAttrs) {
  const sessionId = hookData.session_id || hookData.conversation_id;
  endInteractionForConversation(sessionId, "session_end");
  const activeSession = sessionId ? activeSessions.get(sessionId) : undefined;
  endSession(sessionId, hookData.reason || "session_end");
  if (activeSession) {
    activeSession.span.addEvent("gen_ai.client.session.end", {
      "cursor.session.reason": hookData.reason,
      "cursor.session.duration_ms": hookData.duration_ms,
      "cursor.session.final_status": hookData.final_status
    });
    if (hookData.reason === "error") {
      markSpanError(activeSession.span, hookData.error_message || "session_error");
    }
  }
}

function handleBeforeSubmitPrompt(hookData, baseAttrs) {
  const conversationId = hookData.conversation_id;
  const generationId = hookData.generation_id;

  if (conversationId && openGenerationByConversation.has(conversationId)) {
    endInteraction(openGenerationByConversation.get(conversationId), "superseded");
  }

  const promptLength = typeof hookData.prompt === "string" ? hookData.prompt.length : 0;
  const attrs = {
    ...buildInvokeAgentAttributes(baseAttrs, { agentName: GEN_AI_CURSOR_AGENT_NAME }),
    "cursor.prompt.length": promptLength,
    "cursor.attachment_count": Array.isArray(hookData.attachments) ? hookData.attachments.length : 0
  };

  if (logUserPrompts && typeof hookData.prompt === "string") {
    attrs["cursor.prompt"] = hookData.prompt;
  }

  const span = startSpan(spanNameInvokeAgent(GEN_AI_CURSOR_AGENT_NAME), attrs, context.active(), SpanKind.INTERNAL);
  const ctx = trace.setSpan(context.active(), span);

  if (generationId) {
    activeInteractions.set(generationId, { span, ctx, conversationId });
    if (conversationId) {
      openGenerationByConversation.set(conversationId, generationId);
    }
  }

  promptCounter.add(1, legacyMetricLabels(baseAttrs));
}

function handlePreToolUse(hookData, baseAttrs, hookName = "preToolUse") {
  const parent = resolveParentContext(hookData);
  const toolName = resolveToolName(hookData, "unknown");
  beginExecuteToolSpan(hookData, baseAttrs, parent.ctx, hookName, toolName);
}

function handlePostToolUse(
  hookData,
  baseAttrs,
  { failed, skipAttribution = false, hookName = "postToolUse" }
) {
  const parent = resolveParentContext(hookData);
  const toolName = resolveToolName(hookData, "unknown");
  const durationMs = hookData.duration ?? hookData.duration_ms;
  const toolTokens = estimateToolContextTokens(hookData);
  const toolContext = resolveExecuteToolContext(hookData, hookName, toolName);

  if (!skipAttribution) {
    recordAttributionInvocation(toolContext.attribution, baseAttrs, { success: !failed });
    recordAttributedContextTokens(toolTokens, baseAttrs, toolContext.attribution);
  }

  endExecuteToolSpan(hookData, baseAttrs, parent.ctx, {
    failed,
    hookName,
    toolName,
    toolContext,
    tokenEstimate: toolTokens,
    durationMs
  });
}

/**
 * @param {Record<string, unknown>} hookData
 * @param {Record<string, unknown>} baseAttrs
 * @param {import('@opentelemetry/api').Context} parentCtx
 * @param {string} hookName
 * @param {string} toolNameOverride
 */
function beginExecuteToolSpan(hookData, baseAttrs, parentCtx, hookName, toolNameOverride) {
  const toolContext = resolveExecuteToolContext(hookData, hookName, toolNameOverride);
  const toolUseId = hookData.tool_use_id;

  if (!toolUseId) {
    return;
  }

  if (activeToolCalls.has(toolUseId)) {
    return;
  }

  const attrs = buildExecuteToolAttributes(baseAttrs, toolContext, hookData, {
    includePayloads: logToolDetails
  });

  const span = startSpan(spanNameExecuteTool(toolContext.genAiToolName), attrs, parentCtx, SpanKind.INTERNAL);
  const ctx = trace.setSpan(parentCtx, span);
  activeToolCalls.set(toolUseId, { span, ctx, startHrTime: performance.now() });
}

/**
 * @param {Record<string, unknown>} hookData
 * @param {Record<string, unknown>} baseAttrs
 * @param {import('@opentelemetry/api').Context} parentCtx
 * @param {{ failed: boolean, hookName: string, toolName: string, toolContext: ReturnType<resolveExecuteToolContext>, tokenEstimate: { input: number, output: number }, durationMs?: number }} options
 */
function endExecuteToolSpan(hookData, baseAttrs, parentCtx, options) {
  const { failed, hookName, toolName, toolContext, tokenEstimate, durationMs } = options;
  const toolUseId = hookData.tool_use_id;
  const errorType = resolveErrorType(hookData, failed);
  const active = toolUseId ? activeToolCalls.get(toolUseId) : undefined;

  const resolvedDurationMs =
    typeof durationMs === "number"
      ? durationMs
      : active
        ? Math.round(performance.now() - active.startHrTime)
        : undefined;

  const postAttrs = filterDefined({
    ...buildUsageTokenAttributes(tokenEstimate),
    "cursor.tool.success": !failed,
    "cursor.tool.duration_ms": resolvedDurationMs,
    "cursor.tool.failure_type": hookData.failure_type,
    "cursor.tool.error_message": hookData.error_message,
    "cursor.lines.added": hookData.cursor_lines_added,
    "cursor.lines.removed": hookData.cursor_lines_removed,
    "cursor.file.basename": basenameOnly(hookData.file_path),
    "cursor.file.extension": hookData.file_path ? inferFileExtension(hookData.file_path) : undefined,
    "error.type": errorType
  });

  if (logToolDetails) {
    Object.assign(
      postAttrs,
      buildExecuteToolAttributes(baseAttrs, toolContext, hookData, { includePayloads: true })
    );
  }

  if (active) {
    active.span.setAttributes(postAttrs);
    if (failed) {
      markSpanError(active.span, hookData.error_message || hookData.failure_type || "tool_failed");
    }
    active.span.end();
    activeToolCalls.delete(toolUseId);
  } else {
    const attrs = {
      ...buildExecuteToolAttributes(baseAttrs, toolContext, hookData, {
        includePayloads: logToolDetails
      }),
      ...postAttrs
    };
    const span = startSpan(
      spanNameExecuteTool(toolContext.genAiToolName),
      attrs,
      parentCtx,
      SpanKind.INTERNAL
    );
    if (failed) {
      markSpanError(span, hookData.error_message || hookData.failure_type || "tool_failed");
    }
    span.end();
  }

  toolCounter.add(
    1,
    legacyMetricLabels(baseAttrs, {
      tool_name: toolContext.genAiToolName,
      success: String(!failed)
    })
  );

  if (typeof resolvedDurationMs === "number" && resolvedDurationMs > 0) {
    recordGenAiDuration(resolvedDurationMs / 1000, baseAttrs, GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL, {
      [ATTR_GEN_AI_TOOL_NAME]: toolContext.genAiToolName
    });
  }
}

function handleBeforeShellExecution(hookData, baseAttrs) {
  handlePreToolUse(
    {
      ...hookData,
      tool_name: resolveToolName({ ...hookData, tool_name: hookData.command }, "shell"),
      tool_use_id: hookData.tool_use_id
    },
    baseAttrs,
    "beforeShellExecution"
  );
}

function handleAfterShellExecution(hookData, baseAttrs) {
  const failed =
    hookData.status === "error" ||
    (typeof hookData.exit_code === "number" && hookData.exit_code !== 0);
  const attribution = classifyInvocation("afterShellExecution", hookData);
  const shellTokens = estimateShellContextTokens(hookData);

  recordAttributionInvocation(attribution, baseAttrs, { success: !failed });
  recordAttributedContextTokens(shellTokens, baseAttrs, attribution);

  handlePostToolUse(
    {
      ...hookData,
      tool_name: resolveToolName({ ...hookData, tool_name: hookData.command }, "shell"),
      duration_ms: hookData.duration_ms ?? hookData.duration
    },
    baseAttrs,
    { failed, skipAttribution: true, hookName: "afterShellExecution" }
  );
}

function handleBeforeMcpExecution(hookData, baseAttrs) {
  const mcpServer = resolveMcpServer(hookData);
  const mcpTool = resolveMcpTool(hookData);
  const attribution = classifyInvocation("beforeMCPExecution", hookData, `mcp:${mcpServer}/${mcpTool}`);

  recordAttributionInvocation(attribution, baseAttrs, { phase: "pre" });
  recordAttributedContextTokens(
    { input: estimateTokens(hookData.tool_input), output: 0, source: "estimated" },
    baseAttrs,
    attribution
  );

  handlePreToolUse(
    {
      ...hookData,
      tool_name: `mcp:${mcpServer}/${mcpTool}`,
      mcp_server: mcpServer,
      mcp_tool: mcpTool,
      tool_use_id: hookData.tool_use_id
    },
    baseAttrs,
    "beforeMCPExecution"
  );
}

function handleAfterMcpExecution(hookData, baseAttrs) {
  const mcpServer = resolveMcpServer(hookData);
  const mcpTool = resolveMcpTool(hookData);
  const failed = hookData.status === "error";
  const attribution = classifyInvocation("afterMCPExecution", hookData, `mcp:${mcpServer}/${mcpTool}`);
  const mcpTokens = estimateMcpContextTokens(hookData);

  mcpInvocationCounter.add(
    1,
    legacyMetricLabels(baseAttrs, {
      mcp_server: mcpServer,
      mcp_tool: mcpTool,
      success: String(!failed),
      token_source: mcpTokens.source
    })
  );

  recordAttributionInvocation(attribution, baseAttrs, { success: !failed });
  recordAttributedContextTokens(mcpTokens, baseAttrs, attribution);

  handlePostToolUse(
    {
      ...hookData,
      tool_name: `mcp:${mcpServer}/${mcpTool}`,
      mcp_server: mcpServer,
      mcp_tool: mcpTool,
      duration_ms: hookData.duration_ms ?? hookData.duration
    },
    baseAttrs,
    { failed, skipAttribution: true, hookName: "afterMCPExecution" }
  );
}

function handleBeforeReadFile(hookData, baseAttrs) {
  const attribution = classifyInvocation("beforeReadFile", hookData, "read_file");
  if (attribution.category === "skill") {
    recordAttributionInvocation(attribution, baseAttrs, { phase: "read" });
    recordAttributedContextTokens(
      { input: estimateTokens(hookData.content), output: 0, source: "estimated" },
      baseAttrs,
      attribution
    );
  }

  handlePreToolUse(
    {
      ...hookData,
      tool_name: "read_file",
      tool_use_id: hookData.tool_use_id
    },
    baseAttrs,
    "beforeReadFile"
  );
}

function handleAfterFileEdit(hookData, baseAttrs) {
  recordFileLineStats(hookData, baseAttrs, "agent");
  handlePostToolUse(
    {
      ...hookData,
      tool_name: "edit_file",
      duration_ms: hookData.duration_ms ?? hookData.duration,
      cursor_lines_added: hookData.cursor_lines_added,
      cursor_lines_removed: hookData.cursor_lines_removed
    },
    baseAttrs,
    { failed: false }
  );
}

function handleAfterTabFileEdit(hookData, baseAttrs) {
  recordFileLineStats(hookData, baseAttrs, "tab");
  handlePostToolUse(
    {
      ...hookData,
      tool_name: "tab_edit",
      duration_ms: hookData.duration_ms ?? hookData.duration,
      cursor_lines_added: hookData.cursor_lines_added,
      cursor_lines_removed: hookData.cursor_lines_removed
    },
    baseAttrs,
    { failed: false }
  );
}

function recordFileLineStats(hookData, baseAttrs, source) {
  const stats = extractFileLineStats(hookData);
  if (!stats || (stats.added === 0 && stats.removed === 0)) {
    return;
  }

  hookData.cursor_lines_added = stats.added;
  hookData.cursor_lines_removed = stats.removed;

  const filePath = hookData.file_path;
  const metricExtra = {
    type: "added",
    cursor_code_source: source,
    file_extension: inferFileExtension(filePath)
  };

  if (stats.added > 0) {
    linesOfCodeCounter.add(stats.added, legacyMetricLabels(baseAttrs, { ...metricExtra, type: "added" }));
  }
  if (stats.removed > 0) {
    linesOfCodeCounter.add(
      stats.removed,
      legacyMetricLabels(baseAttrs, { ...metricExtra, type: "removed" })
    );
  }
}

function handleSubagentStart(hookData, baseAttrs) {
  const attribution = classifyInvocation("subagentStart", hookData, hookData.subagent_type || "subagent");
  recordAttributionInvocation(attribution, baseAttrs, { phase: "start" });

  const parent = resolveParentContext(hookData, hookData.parent_conversation_id);
  const subagentId = hookData.subagent_id;
  const agentName = hookData.subagent_type || "subagent";

  const span = startSpan(
    spanNameInvokeAgent(agentName),
    {
      ...buildInvokeAgentAttributes(baseAttrs, { agentName, agentId: subagentId }),
      "cursor.attribution.category": attribution.category,
      "cursor.attribution.name": attribution.name,
      "gen_ai.request.model": hookData.subagent_model || baseAttrs[ATTR_GEN_AI_REQUEST_MODEL],
      "cursor.subagent.parent_conversation_id": hookData.parent_conversation_id,
      "cursor.subagent.is_parallel_worker": hookData.is_parallel_worker ?? false
    },
    parent.ctx,
    SpanKind.INTERNAL
  );

  const ctx = trace.setSpan(parent.ctx, span);
  if (subagentId) {
    activeSubagents.set(subagentId, { span, ctx });
  }
}

function handleSubagentStop(hookData, baseAttrs) {
  const subagentId = hookData.subagent_id;
  const agentName = hookData.subagent_type || "subagent";
  const active = subagentId ? activeSubagents.get(subagentId) : undefined;

  if (active) {
    active.span.setAttributes(
      filterDefined({
        ...buildInvokeAgentAttributes(baseAttrs, { agentName, agentId: subagentId }),
        "cursor.subagent.status": hookData.status,
        "cursor.subagent.duration_ms": hookData.duration_ms,
        "cursor.subagent.tool_call_count": hookData.tool_call_count,
        "cursor.subagent.message_count": hookData.message_count
      })
    );

    if (typeof hookData.duration_ms === "number") {
      recordGenAiDuration(hookData.duration_ms / 1000, baseAttrs, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT, {
        "gen_ai.agent.name": agentName
      });
    }

    if (hookData.status === "error") {
      markSpanError(active.span, "subagent_error");
    }
    active.span.end();
    activeSubagents.delete(subagentId);
  } else {
    const span = startSpan(
      spanNameInvokeAgent(agentName),
      {
        ...buildInvokeAgentAttributes(baseAttrs, { agentName, agentId: subagentId }),
        "cursor.subagent.status": hookData.status,
        "cursor.subagent.duration_ms": hookData.duration_ms
      },
      context.active(),
      SpanKind.INTERNAL
    );

    if (hookData.status === "error") {
      markSpanError(span, "subagent_error");
    }
    span.end();
  }
}

function handleAfterAgentResponse(hookData, baseAttrs) {
  const parent = resolveParentContext(hookData);
  const textLength = typeof hookData.text === "string" ? hookData.text.length : 0;

  if (parent.interaction) {
    parent.interaction.span.addEvent("gen_ai.client.inference.operation.details", {
      [ATTR_GEN_AI_OUTPUT_TYPE]: "text",
      "cursor.response.length": textLength
    });
    return;
  }

  const span = startSpan(
    spanNameInvokeAgent(GEN_AI_CURSOR_AGENT_NAME),
    {
      ...buildInvokeAgentAttributes(baseAttrs, { agentName: GEN_AI_CURSOR_AGENT_NAME }),
      [ATTR_GEN_AI_OUTPUT_TYPE]: "text",
      "cursor.response.length": textLength,
      "cursor.span.role": "response"
    },
    parent.ctx,
    SpanKind.INTERNAL
  );
  span.end();
}

function handleAfterAgentThought(hookData, baseAttrs) {
  const durationMs = hookData.duration_ms;
  const parent = resolveParentContext(hookData);

  if (parent.interaction) {
    parent.interaction.span.addEvent("gen_ai.client.inference.operation.details", {
      "cursor.thought.duration_ms": durationMs,
      ...buildReasoningUsageAttributes(hookData.text)
    });
  }

  if (typeof durationMs === "number") {
    recordGenAiDuration(durationMs / 1000, baseAttrs, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT);
  }
}

function handleStop(hookData, baseAttrs) {
  const generationId = hookData.generation_id;
  if (generationId && activeInteractions.has(generationId)) {
    const active = activeInteractions.get(generationId);
    active.span.addEvent("gen_ai.client.inference.operation.details", {
      "cursor.agent.status": hookData.status,
      "cursor.agent.loop_count": hookData.loop_count
    });
    active.span.setAttributes({
      "cursor.agent.status": hookData.status,
      "cursor.agent.loop_count": hookData.loop_count
    });
    if (hookData.status === "error") {
      markSpanError(active.span, "agent_loop_error");
    }
    endInteraction(generationId, "stop");
  } else {
    endInteractionForConversation(hookData.conversation_id, "stop");
  }
}

function handlePreCompact(hookData, baseAttrs) {
  const tokens = hookData.context_tokens;
  if (typeof tokens === "number") {
    genAiTokenUsage.record(tokens, semconvMetricLabels(baseAttrs, GEN_AI_OPERATION_NAME_VALUE_INVOKE_AGENT, {
      "gen_ai.token.type": "input"
    }));
  }

  const parent = resolveParentContext(hookData);
  const span = startSpan(
    spanNameInvokeAgent(GEN_AI_CURSOR_AGENT_NAME),
    {
      ...buildInvokeAgentAttributes(baseAttrs, { agentName: GEN_AI_CURSOR_AGENT_NAME }),
      ...buildUsageTokenAttributes({ input: tokens, output: 0 }),
      "cursor.compaction.trigger": hookData.trigger,
      "cursor.compaction.context_usage_percent": hookData.context_usage_percent,
      "cursor.compaction.context_window_size": hookData.context_window_size,
      "cursor.compaction.message_count": hookData.message_count,
      "cursor.span.role": "compaction"
    },
    parent.ctx,
    SpanKind.INTERNAL
  );
  span.end();
}

function recordGenericHook(hookName, hookData, baseAttrs) {
  const span = startSpan(
    spanNameInvokeAgent(GEN_AI_CURSOR_AGENT_NAME),
    {
      ...buildInvokeAgentAttributes(baseAttrs, { agentName: GEN_AI_CURSOR_AGENT_NAME }),
      "cursor.hook.name": hookName
    },
    context.active(),
    SpanKind.INTERNAL
  );
  span.addEvent("gen_ai.client.inference.operation.details", {
    "cursor.payload_size": JSON.stringify(hookData).length
  });
  span.end();
}

function endInteraction(generationId, reason) {
  const active = activeInteractions.get(generationId);
  if (!active) {
    return;
  }

  active.span.setAttribute("cursor.interaction.end_reason", reason);
  active.span.end();
  activeInteractions.delete(generationId);

  for (const [conversationId, openGen] of openGenerationByConversation.entries()) {
    if (openGen === generationId) {
      openGenerationByConversation.delete(conversationId);
    }
  }
}

function endInteractionForConversation(conversationId, reason) {
  if (!conversationId) {
    return;
  }
  const generationId = openGenerationByConversation.get(conversationId);
  if (generationId) {
    endInteraction(generationId, reason);
  }
}

function resolveParentContext(hookData, conversationOverride) {
  const generationId = hookData.generation_id;
  if (generationId && activeInteractions.has(generationId)) {
    const interaction = activeInteractions.get(generationId);
    return { ctx: interaction.ctx, interaction };
  }

  const conversationId = conversationOverride || hookData.conversation_id;
  const openGen = conversationId ? openGenerationByConversation.get(conversationId) : undefined;
  if (openGen && activeInteractions.has(openGen)) {
    const interaction = activeInteractions.get(openGen);
    return { ctx: interaction.ctx, interaction };
  }

  return { ctx: context.active(), interaction: undefined };
}

function buildBaseAttributes(event, hookData) {
  const conversationId =
    hookData.conversation_id || event.conversation_id || hookData.session_id || event.session_id;
  const generationId = hookData.generation_id || event.generation_id;
  const model = hookData.model || event.model || hookData.subagent_model;

  return filterDefined({
    "cursor.hook.name": hookData.hook_event_name || event.event_name,
    "cursor.user": event.user || hookData.user_email || "unknown",
    "cursor.repo": event.repo || hookData.workspace_roots?.[0] || "unknown",
    "cursor.version": hookData.cursor_version || event.cursor_version,
    [ATTR_GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_NAME,
    [ATTR_GEN_AI_CONVERSATION_ID]: conversationId,
    [ATTR_GEN_AI_REQUEST_MODEL]: model,
    "cursor.conversation.id": conversationId,
    "cursor.generation.id": generationId,
    "cursor.user.email": maskUserEmail ? maskEmail(hookData.user_email || event.user) : (hookData.user_email || event.user),
    [ATTR_GEN_AI_RESPONSE_ID]: generationId
  });
}

function semconvMetricLabels(baseAttrs, operationName, extra = {}) {
  return filterDefined({
    [ATTR_GEN_AI_OPERATION_NAME]: operationName,
    [ATTR_GEN_AI_REQUEST_MODEL]: baseAttrs[ATTR_GEN_AI_REQUEST_MODEL] || "unknown",
    [ATTR_GEN_AI_PROVIDER_NAME]: baseAttrs[ATTR_GEN_AI_PROVIDER_NAME] || GEN_AI_PROVIDER_NAME,
    ...extra
  });
}

function legacyMetricLabels(baseAttrs, extra = {}) {
  return {
    cursor_user: baseAttrs["cursor.user.email"] || baseAttrs["cursor.user"] || "unknown",
    cursor_model: baseAttrs[ATTR_GEN_AI_REQUEST_MODEL] || "unknown",
    cursor_repo: baseAttrs["cursor.repo"] || "unknown",
    ...extra
  };
}

function recordGenAiDuration(durationSeconds, baseAttrs, operationName, extra = {}) {
  if (durationSeconds <= 0) {
    return;
  }
  genAiOperationDuration.record(
    durationSeconds,
    semconvMetricLabels(baseAttrs, operationName, extra)
  );
}

function incrementHookCounter(hookName, baseAttrs) {
  hookEventCounter.add(1, legacyMetricLabels(baseAttrs, { cursor_hook_name: hookName }));
}

function recordAttributionInvocation(attribution, baseAttrs, extra = {}) {
  attributionInvocationCounter.add(
    1,
    legacyMetricLabels(baseAttrs, {
      attribution_category: attribution.category,
      attribution_name: attribution.name,
      ...extra
    })
  );
}

/**
 * @param {{ input: number, output: number, source?: string }} tokenEstimate
 * @param {Record<string, string | undefined>} baseAttrs
 * @param {{ category: string, name: string, detail?: string, operationName?: string }} attribution
 */
function recordAttributedContextTokens(tokenEstimate, baseAttrs, attribution) {
  if (!trackAttributedTokens) {
    return;
  }

  const operationName = attribution.operationName || "execute_tool";
  const labels = {
    attribution_category: attribution.category,
    attribution_name: attribution.name,
    token_source: tokenEstimate.source || "estimated"
  };

  if (tokenEstimate.input > 0) {
    attributedContextTokensCounter.add(
      tokenEstimate.input,
      legacyMetricLabels(baseAttrs, { ...labels, token_type: "input" })
    );
    genAiTokenUsage.record(
      tokenEstimate.input,
      semconvMetricLabels(baseAttrs, operationName, {
        "gen_ai.token.type": "input",
        "cursor.attribution.category": attribution.category,
        "cursor.attribution.name": attribution.name,
        "cursor.attribution.token_source": tokenEstimate.source || "estimated"
      })
    );
  }

  if (tokenEstimate.output > 0) {
    attributedContextTokensCounter.add(
      tokenEstimate.output,
      legacyMetricLabels(baseAttrs, { ...labels, token_type: "output" })
    );
    genAiTokenUsage.record(
      tokenEstimate.output,
      semconvMetricLabels(baseAttrs, operationName, {
        "gen_ai.token.type": "output",
        "cursor.attribution.category": attribution.category,
        "cursor.attribution.name": attribution.name,
        "cursor.attribution.token_source": tokenEstimate.source || "estimated"
      })
    );
  }
}

function emitHookLog(hookName, hookData, baseAttrs) {
  const logBody = { hook: hookName, ...pickLogFields(hookData) };
  if (!logUserPrompts && logBody.prompt) {
    delete logBody.prompt;
    logBody.prompt_length = typeof hookData.prompt === "string" ? hookData.prompt.length : 0;
  }

  logger.emit({
    severityText: hookName.includes("Failure") || hookData.status === "error" ? "WARN" : "INFO",
    body: `cursor ${hookName}`,
    attributes: {
      ...filterDefined(baseAttrs),
      "cursor.log.payload": JSON.stringify(logBody)
    }
  });
}

function startSpan(name, attributes, parentCtx = context.active(), kind = SpanKind.INTERNAL) {
  return tracer.startSpan(name, { kind, attributes: filterDefined(attributes) }, parentCtx);
}

function markSpanError(span, errorType) {
  span.setAttributes({ "error.type": normalizeErrorType(errorType) });
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(errorType) });
}

function resolveErrorType(hookData, failed) {
  if (!failed) {
    return undefined;
  }
  return hookData.failure_type || hookData.error_message || "tool_failed";
}

function normalizeErrorType(value) {
  const text = String(value || "_OTHER").trim();
  if (!text) {
    return "_OTHER";
  }
  return text.length > 128 ? text.slice(0, 128) : text;
}

function pickLogFields(hookData) {
  const keys = [
    "hook_event_name",
    "conversation_id",
    "generation_id",
    "model",
    "tool_name",
    "mcp_server",
    "mcp_tool",
    "url",
    "command",
    "duration",
    "duration_ms",
    "status",
    "reason",
    "subagent_id",
    "subagent_type",
    "prompt",
    "context_tokens",
    "context_usage_percent"
  ];
  const out = {};
  for (const key of keys) {
    if (hookData[key] !== undefined && hookData[key] !== null) {
      out[key] = hookData[key];
    }
  }
  return out;
}

function normalizeHookName(name) {
  if (!name) {
    return "unknown";
  }
  const map = {
    "cursor.session.start": "sessionStart",
    "cursor.before_submit_prompt": "beforeSubmitPrompt"
  };
  return map[name] || name;
}

export function observeCursorApiMetric(metricName, value, attributes = {}) {
  const key = `${metricName}:${JSON.stringify(attributes)}`;
  apiGaugeStore.set(key, {
    value,
    ttlEpochMs: Date.now() + 5 * 60 * 1000,
    attributes: {
      cursor_metric_name: metricName,
      ...attributes
    }
  });
}

export function flushTelemetry() {
  return Promise.allSettled([
    tracerProvider.forceFlush(),
    meterProvider.forceFlush(),
    loggerProvider.forceFlush()
  ]);
}

export function emitDebugTelemetry() {
  const attrs = {
    "cursor.event_name": "cursor.debug.flush_test",
    "cursor.source": "debug_endpoint",
    "cursor.user": process.env.USER || "unknown"
  };

  const span = tracer.startSpan("cursor.debug.flush_test", { attributes: attrs });
  span.end();
  hookEventCounter.add(1, { cursor_hook_name: "debug.flush_test", cursor_source: "debug_endpoint" });
  logger.emit({
    severityText: "INFO",
    body: "cursor debug flush test",
    attributes: attrs
  });
}

export function getOtelExportConfig() {
  return {
    serviceName,
    tracesEndpoint,
    metricsEndpoint,
    logsEndpoint,
    metricsTemporality:
      process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE || "cumulative (sdk default)",
    metricExportIntervalMs: Number(process.env.METRIC_EXPORT_INTERVAL_MS || 15000),
    authConfigured: Boolean(process.env.OTEL_EXPORTER_OTLP_HEADERS)
  };
}

export function shutdownTelemetry() {
  for (const [generationId] of activeInteractions) {
    endInteraction(generationId, "shutdown");
  }
  for (const [, active] of activeSubagents) {
    active.span.end();
  }
  activeSubagents.clear();

  return Promise.allSettled([
    tracerProvider.shutdown(),
    meterProvider.shutdown(),
    loggerProvider.shutdown()
  ]);
}

function parseHeaders(rawHeaderList) {
  if (!rawHeaderList) {
    return {};
  }

  const normalized = rawHeaderList.trim().replace(/^["']|["']$/g, "");

  return normalized.split(",").reduce((acc, pair) => {
    const [key, ...rest] = pair.split("=");
    if (!key || rest.length === 0) {
      return acc;
    }
    acc[key.trim()] = rest.join("=").trim();
    return acc;
  }, {});
}

function sanitizeEvent(event) {
  if (!event || typeof event !== "object") {
    return {};
  }

  const clone = structuredClone(event);
  for (const key of ["apiKey", "token", "CURSOR_ADMIN_API_KEY"]) {
    if (clone[key]) {
      clone[key] = "***";
    }
  }
  if (clone.data?.apiKey) {
    clone.data.apiKey = "***";
  }
  return clone;
}

function filterDefined(attrs) {
  return Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

// Reserved for future LLM hook instrumentation (CLIENT span per model call).
export { spanNameChat };
