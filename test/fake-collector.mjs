#!/usr/bin/env node
// Minimal OTLP/HTTP JSON receiver for local E2E testing.
// Prints spans and metric data points to stdout; returns 200 for everything.
import http from "node:http";

function extractAttrs(attributes = []) {
  return Object.fromEntries(
    attributes.map((a) => {
      const v = a.value;
      const val =
        v.boolValue ??
        v.stringValue ??
        (v.intValue !== undefined ? Number(v.intValue) : undefined) ??
        v.doubleValue;
      return [a.key, val];
    })
  );
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());

      if (req.url.includes("traces")) {
        for (const rs of body.resourceSpans ?? []) {
          for (const ss of rs.scopeSpans ?? []) {
            for (const span of ss.spans ?? []) {
              const attrs = extractAttrs(span.attributes);
              const stale = attrs["cursor.tool.stale"] ?? attrs["cursor.session.stale"] ?? attrs["cursor.interaction.stale"] ?? attrs["cursor.subagent.stale"];
              const exitCode = attrs["cursor.tool.exit_code"];
              const tag = stale ? " [STALE]" : "";
              console.log(`[SPAN]${tag} ${span.name}`);
              if (exitCode !== undefined) console.log(`  cursor.tool.exit_code = ${exitCode}`);
              const interesting = Object.entries(attrs).filter(([k]) =>
                k.startsWith("cursor.tool") || k.startsWith("cursor.session") || k.startsWith("cursor.interaction") || k === "error.type"
              );
              for (const [k, v] of interesting) console.log(`  ${k} = ${v}`);
            }
          }
        }
      }

      if (req.url.includes("metrics")) {
        for (const rm of body.resourceMetrics ?? []) {
          for (const sm of rm.scopeMetrics ?? []) {
            for (const m of sm.metrics ?? []) {
              if (!m.name.startsWith("cursor_attributed")) continue;
              const points = m.sum?.dataPoints ?? m.gauge?.dataPoints ?? [];
              for (const p of points) {
                const attrs = extractAttrs(p.attributes);
                const val = p.asInt !== undefined ? Number(p.asInt) : p.asDouble;
                console.log(`[METRIC] ${m.name} = ${val}`, JSON.stringify(attrs));
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[collector] parse error:", e.message);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  });
});

server.listen(4318, "127.0.0.1", () =>
  console.log("[collector] OTLP/HTTP listening on http://127.0.0.1:4318")
);
