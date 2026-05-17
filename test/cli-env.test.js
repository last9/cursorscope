import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildLast9Env, normalizeOtlpBase } from "../src/cli/env-templates.js";
import { resolveHome } from "../src/cli/paths.js";
import { runCli } from "../src/cli/index.js";
import { formatOtlpHeaders } from "../src/cli/prompt.js";
import { LAST9_OTEL_INTEGRATION_URL } from "../src/cli/last9.js";

describe("cli env templates", () => {
  it("buildLast9Env includes Last9 OTLP endpoints and home", () => {
    const home = "/Users/me/.cursorscope";
    const env = buildLast9Env(home, "1.2.3");
    assert.match(env, /otlp-aps1\.last9\.io\/v1\/traces/);
    assert.match(env, /OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative/);
    assert.match(env, new RegExp(`CURSORSCOPE_HOME=${home.replaceAll("/", "\\/")}`));
    assert.match(env, /OTEL_SERVICE_VERSION=1\.2\.3/);
  });

  it("buildLast9Env uses custom base URL and headers", () => {
    const env = buildLast9Env("/tmp/cs", "1.0.0", {
      otlpBase: "https://otlp-eu.last9.io/",
      otlpHeaders: "Authorization=Basic abc123"
    });
    assert.match(env, /OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https:\/\/otlp-eu\.last9\.io\/v1\/traces/);
    assert.match(env, /OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic abc123/);
  });

  it("normalizeOtlpBase strips trailing slashes", () => {
    assert.equal(normalizeOtlpBase("https://otlp-aps1.last9.io///"), "https://otlp-aps1.last9.io");
  });

  it("formatOtlpHeaders accepts base64 and user:password", () => {
    assert.equal(formatOtlpHeaders("YWJj"), "Authorization=Basic YWJj");
    const fromUserPass = formatOtlpHeaders("user:secret");
    assert.match(fromUserPass, /^Authorization=Basic /);
    assert.notEqual(fromUserPass, "Authorization=Basic user:secret");
  });

  it("resolveHome expands tilde", () => {
    const resolved = resolveHome("~/.cursorscope");
    assert.ok(!resolved.includes("~"));
    assert.ok(resolved.endsWith(".cursorscope"));
  });

  it("runCli parses setup --help", async () => {
    const code = await runCli(["--help"]);
    assert.equal(code, 0);
  });

  it("LAST9_OTEL_INTEGRATION_URL points at OpenTelemetry integration", () => {
    const url = new URL(LAST9_OTEL_INTEGRATION_URL);
    assert.equal(url.hostname, "app.last9.io");
    assert.equal(url.searchParams.get("integration"), "OpenTelemetry");
  });
});
