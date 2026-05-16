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

const GEN_AI_PROVIDER = "cursor";
const GEN_AI_AGENT_NAME = "Cursor";
const logUserPrompts = process.env.CURSOR_LOG_USER_PROMPTS === "true";
const logToolDetails = process.env.CURSOR_LOG_TOOL_DETAILS === "true";
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

  const span = startSpan(spanNameInvokeAgent(GEN_AI_AGENT_NAME), {
    ...baseAttrs,
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.agent.name": GEN_AI_AGENT_NAME,
    "cursor.composer_mode": hookData.composer_mode,
    "cursor.is_background_agent": hookData.is_background_agent ?? false,
    "cursor.span.role": "session"
  });

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
  endSession(sessionId, hookData.reason || "session_end");

  const span = startSpan("cursor.session.end", {
    ...baseAttrs,
    "cursor.session.reason": hookData.reason,
    "cursor.session.duration_ms": hookData.duration_ms,
    "cursor.session.final_status": hookData.final_status
  });

  if (hookData.reason === "error") {
    markSpanError(span, hookData.error_message || "session_error");
  }
  span.end();
}

function handleBeforeSubmitPrompt(hookData, baseAttrs) {
  const conversationId = hookData.conversation_id;
  const generationId = hookData.generation_id;

  if (conversationId && openGenerationByConversation.has(conversationId)) {
    endInteraction(openGenerationByConversation.get(conversationId), "superseded");
  }

  const promptLength = typeof hookData.prompt === "string" ? hookData.prompt.length : 0;
  const attrs = {
    ...baseAttrs,
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.agent.name": GEN_AI_AGENT_NAME,
    "gen_ai.output.type": "text",
    "cursor.prompt.length": promptLength,
    "cursor.attachment_count": Array.isArray(hookData.attachments) ? hookData.attachments.length : 0
  };

  if (logUserPrompts && typeof hookData.prompt === "string") {
    attrs["cursor.prompt"] = hookData.prompt;
  }

  const span = startSpan(spanNameInvokeAgent(GEN_AI_AGENT_NAME), attrs, context.active(), SpanKind.INTERNAL);
  const ctx = trace.setSpan(context.active(), span);

  if (generationId) {
    activeInteractions.set(generationId, { span, ctx, conversationId });
    if (conversationId) {
      openGenerationByConversation.set(conversationId, generationId);
    }
  }

  promptCounter.add(1, legacyMetricLabels(baseAttrs));
}

function handlePreToolUse(hookData, baseAttrs) {
  const parent = resolveParentContext(hookData);
  const toolName = resolveToolName(hookData, "unknown");
  if (parent.interaction) {
    parent.interaction.span.addEvent("gen_ai.tool.queued", {
      "gen_ai.tool.name": toolName,
      "gen_ai.tool.call.id": hookData.tool_use_id
    });
    return;
  }

  const span = startSpan(spanNameExecuteTool(toolName), {
    ...baseAttrs,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": toolName,
    "gen_ai.tool.call.id": hookData.tool_use_id,
    "cursor.hook.phase": "pre"
  }, parent.ctx);
  span.end();
}

function handlePostToolUse(hookData, baseAttrs, { failed }) {
  const parent = resolveParentContext(hookData);
  const toolName = resolveToolName(hookData, "unknown");
  const durationMs = hookData.duration ?? hookData.duration_ms;
  const errorType = resolveErrorType(hookData, failed);

  const attrs = {
    ...baseAttrs,
    "gen_ai.operation.name": "execute_tool",
    "gen_ai.tool.name": toolName,
    "gen_ai.tool.call.id": hookData.tool_use_id,
    "gen_ai.tool.type": inferToolType(toolName),
    "cursor.tool.success": !failed,
    "cursor.tool.duration_ms": durationMs,
    "cursor.tool.failure_type": hookData.failure_type,
    "cursor.tool.error_message": hookData.error_message
  };

  if (errorType) {
    attrs["error.type"] = errorType;
  }

  const span = startSpan(
    spanNameExecuteTool(toolName),
    attrs,
    parent.ctx,
    SpanKind.INTERNAL
  );

  if (failed) {
    markSpanError(span, hookData.error_message || hookData.failure_type || "tool_failed");
  }
  span.end();

  toolCounter.add(1, legacyMetricLabels(baseAttrs, { tool_name: toolName, success: String(!failed) }));

  if (typeof durationMs === "number") {
    recordGenAiDuration(durationMs / 1000, baseAttrs, "execute_tool", { "gen_ai.tool.name": toolName });
  }

  if (parent.interaction) {
    parent.interaction.span.addEvent(failed ? "gen_ai.tool.error" : "gen_ai.tool.completed", {
      "gen_ai.tool.name": toolName,
      "cursor.tool.duration_ms": durationMs
    });
  }
}

function handleSubagentStart(hookData, baseAttrs) {
  const parent = resolveParentContext(hookData, hookData.parent_conversation_id);
  const subagentId = hookData.subagent_id;
  const agentName = hookData.subagent_type || "subagent";

  const span = startSpan(
    spanNameCreateAgent(agentName),
    {
      ...baseAttrs,
      "gen_ai.operation.name": "create_agent",
      "gen_ai.agent.id": subagentId,
      "gen_ai.agent.name": agentName,
      "gen_ai.request.model": hookData.subagent_model || baseAttrs["gen_ai.request.model"],
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
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": agentName,
        "cursor.subagent.status": hookData.status,
        "cursor.subagent.duration_ms": hookData.duration_ms,
        "cursor.subagent.tool_call_count": hookData.tool_call_count,
        "cursor.subagent.message_count": hookData.message_count
      })
    );

    if (typeof hookData.duration_ms === "number") {
      recordGenAiDuration(hookData.duration_ms / 1000, baseAttrs, "invoke_agent", {
        "gen_ai.agent.name": agentName
      });
    }

    if (hookData.status === "error") {
      markSpanError(active.span, "subagent_error");
    }
    active.span.end();
    activeSubagents.delete(subagentId);
  } else {
    const span = startSpan(spanNameInvokeAgent(agentName), {
      ...baseAttrs,
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": agentName,
      "cursor.subagent.status": hookData.status,
      "cursor.subagent.duration_ms": hookData.duration_ms
    });

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
    parent.interaction.span.addEvent("gen_ai.response", {
      "gen_ai.output.type": "text",
      "cursor.response.length": textLength
    });
    return;
  }

  const span = startSpan("gen_ai.response", {
    ...baseAttrs,
    "gen_ai.output.type": "text",
    "cursor.response.length": textLength
  }, parent.ctx);
  span.end();
}

function handleAfterAgentThought(hookData, baseAttrs) {
  const durationMs = hookData.duration_ms;
  const parent = resolveParentContext(hookData);

  if (parent.interaction) {
    parent.interaction.span.addEvent("gen_ai.reasoning", {
      "cursor.thought.duration_ms": durationMs,
      "gen_ai.usage.reasoning.output_tokens": estimateReasoningTokens(hookData.text)
    });
  }

  if (typeof durationMs === "number") {
    recordGenAiDuration(durationMs / 1000, baseAttrs, "invoke_agent");
  }
}

function handleStop(hookData, baseAttrs) {
  const generationId = hookData.generation_id;
  if (generationId && activeInteractions.has(generationId)) {
    const active = activeInteractions.get(generationId);
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

  const span = startSpan("cursor.agent.stop", {
    ...baseAttrs,
    "gen_ai.operation.name": "invoke_agent",
    "cursor.agent.status": hookData.status,
    "cursor.agent.loop_count": hookData.loop_count
  });
  span.end();
}

function handlePreCompact(hookData, baseAttrs) {
  const tokens = hookData.context_tokens;
  if (typeof tokens === "number") {
    genAiTokenUsage.record(tokens, semconvMetricLabels(baseAttrs, "invoke_agent", {
      "gen_ai.token.type": "input"
    }));
  }

  const parent = resolveParentContext(hookData);
  const span = startSpan("cursor.compaction", {
    ...baseAttrs,
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.usage.input_tokens": tokens,
    "cursor.compaction.trigger": hookData.trigger,
    "cursor.compaction.context_usage_percent": hookData.context_usage_percent,
    "cursor.compaction.context_window_size": hookData.context_window_size,
    "cursor.compaction.message_count": hookData.message_count
  }, parent.ctx);
  span.end();
}

function recordGenericHook(hookName, hookData, baseAttrs) {
  const span = startSpan("cursor.hook", {
    ...baseAttrs,
    "cursor.hook.name": hookName
  });
  span.addEvent("cursor.hook.received", {
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

  const attrs = {
    "cursor.hook.name": hookData.hook_event_name || event.event_name,
    "cursor.user": event.user || hookData.user_email || "unknown",
    "cursor.repo": event.repo || hookData.workspace_roots?.[0] || "unknown",
    "cursor.version": hookData.cursor_version || event.cursor_version,
    "gen_ai.provider.name": GEN_AI_PROVIDER,
    "gen_ai.conversation.id": conversationId,
    "gen_ai.request.model": model,
    "cursor.conversation.id": conversationId,
    "cursor.generation.id": generationId,
    "cursor.user.email": hookData.user_email || event.user
  };

  attrs["gen_ai.system"] = GEN_AI_PROVIDER;

  if (generationId) {
    attrs["gen_ai.response.id"] = generationId;
  }

  return attrs;
}

function semconvMetricLabels(baseAttrs, operationName, extra = {}) {
  return filterDefined({
    "gen_ai.operation.name": operationName,
    "gen_ai.request.model": baseAttrs["gen_ai.request.model"] || "unknown",
    "gen_ai.provider.name": baseAttrs["gen_ai.provider.name"] || GEN_AI_PROVIDER,
    "gen_ai.system": GEN_AI_PROVIDER,
    ...extra
  });
}

function legacyMetricLabels(baseAttrs, extra = {}) {
  return {
    cursor_user: baseAttrs["cursor.user.email"] || baseAttrs["cursor.user"] || "unknown",
    cursor_model: baseAttrs["gen_ai.request.model"] || "unknown",
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

function spanNameInvokeAgent(agentName) {
  return agentName ? `invoke_agent ${agentName}` : "invoke_agent";
}

function spanNameCreateAgent(agentName) {
  return agentName ? `create_agent ${agentName}` : "create_agent";
}

function spanNameExecuteTool(toolName) {
  return toolName ? `execute_tool ${toolName}` : "execute_tool";
}

function spanNameChat(model) {
  return model ? `chat ${model}` : "chat";
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

function inferToolType(toolName) {
  const name = String(toolName || "").toLowerCase();
  if (name.includes("mcp")) {
    return "extension";
  }
  if (name === "shell" || name === "bash") {
    return "function";
  }
  return "function";
}

function estimateReasoningTokens(text) {
  if (typeof text !== "string" || text.length === 0) {
    return undefined;
  }
  return Math.ceil(text.length / 4);
}

function pickLogFields(hookData) {
  const keys = [
    "hook_event_name",
    "conversation_id",
    "generation_id",
    "model",
    "tool_name",
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
