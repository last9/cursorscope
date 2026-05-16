import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getConfiguredOtlpEndpoints,
  resolveOtlpSignalEndpoint
} from "../src/otlp-endpoints.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("otlp-endpoints", () => {
  describe("resolveOtlpSignalEndpoint", () => {
    it("prefers explicit per-signal endpoint", () => {
      assert.equal(
        resolveOtlpSignalEndpoint("traces", "https://example.com/v1/traces", "http://localhost:4318/v1/traces"),
        "https://example.com/v1/traces"
      );
    });

    it("derives endpoint from OTEL_EXPORTER_OTLP_ENDPOINT base", () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example.com/";
      assert.equal(
        resolveOtlpSignalEndpoint("metrics", undefined, "http://localhost:4318/v1/metrics"),
        "https://otlp.example.com/v1/metrics"
      );
    });

    it("falls back to local default", () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      assert.equal(
        resolveOtlpSignalEndpoint("logs", undefined, "http://localhost:4318/v1/logs"),
        "http://localhost:4318/v1/logs"
      );
    });
  });

  describe("getConfiguredOtlpEndpoints", () => {
    it("returns traces, metrics, and logs endpoints", () => {
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://t/v1/traces";
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "https://m/v1/metrics";
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://l/v1/logs";
      const endpoints = getConfiguredOtlpEndpoints();
      assert.deepEqual(endpoints, {
        traces: "https://t/v1/traces",
        metrics: "https://m/v1/metrics",
        logs: "https://l/v1/logs"
      });
    });
  });
});
