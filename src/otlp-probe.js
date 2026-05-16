import "./env.js";
import { getConfiguredOtlpEndpoints } from "./otlp-endpoints.js";

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

async function probeUrl(signal, url, headers) {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json"
      },
      body: "{}"
    });

    const bodyPreview = (await response.text()).slice(0, 300);

    return {
      signal,
      url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      bodyPreview
    };
  } catch (error) {
    return {
      signal,
      url,
      ok: false,
      status: null,
      statusText: null,
      durationMs: Date.now() - startedAt,
      error: error.message
    };
  }
}

export async function probeConfiguredOtlpEndpoints() {
  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const configured = getConfiguredOtlpEndpoints();
  const endpoints = [
    { signal: "traces", url: configured.traces },
    { signal: "metrics", url: configured.metrics },
    { signal: "logs", url: configured.logs }
  ];

  const results = [];
  for (const endpoint of endpoints) {
    results.push(await probeUrl(endpoint.signal, endpoint.url, headers));
  }

  return {
    checkedAt: new Date().toISOString(),
    note:
      "A 4xx response can still mean the endpoint is reachable (auth/body validation). Focus on network errors and 401/403.",
    results
  };
}
