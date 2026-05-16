export function resolveOtlpSignalEndpoint(signal, explicitEndpoint, localDefault) {
  if (explicitEndpoint) {
    return explicitEndpoint;
  }

  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, "");
  if (base) {
    return `${base}/v1/${signal}`;
  }

  return localDefault;
}

export function getConfiguredOtlpEndpoints() {
  return {
    traces: resolveOtlpSignalEndpoint(
      "traces",
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      "http://localhost:4318/v1/traces"
    ),
    metrics: resolveOtlpSignalEndpoint(
      "metrics",
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
      "http://localhost:4318/v1/metrics"
    ),
    logs: resolveOtlpSignalEndpoint(
      "logs",
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
      "http://localhost:4318/v1/logs"
    )
  };
}
