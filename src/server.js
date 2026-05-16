import "./env.js";
import express from "express";
import { maybeStartCursorApiPolling, stopCursorApiPolling } from "./cursor-api-poller.js";
import { probeConfiguredOtlpEndpoints } from "./otlp-probe.js";
import {
  emitDebugTelemetry,
  flushTelemetry,
  getOtelExportConfig,
  recordHookEvent,
  shutdownTelemetry
} from "./telemetry.js";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "cursorscope",
    ts: new Date().toISOString()
  });
});

app.get("/debug/otel-config", (_req, res) => {
  res.status(200).json(getOtelExportConfig());
});

app.post("/debug/emit-and-flush", async (_req, res) => {
  try {
    emitDebugTelemetry();
    await flushTelemetry();
    res.status(200).json({ ok: true, message: "debug trace/metric/log emitted and flushed" });
  } catch (error) {
    console.error("Debug emit-and-flush failed:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/debug/otlp-probe", async (_req, res) => {
  try {
    const report = await probeConfiguredOtlpEndpoints();
    res.status(200).json(report);
  } catch (error) {
    console.error("OTLP probe failed:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/cursor/hooks", (req, res) => {
  try {
    const event = req.body || {};
    recordHookEvent({
      ...event,
      source: event.source || "cursor_hook"
    });
    res.status(202).json({ accepted: true });
  } catch (error) {
    console.error("Failed to process hook event:", error);
    res.status(500).json({ accepted: false, error: error.message });
  }
});

const server = app.listen(port, () => {
  console.log(`cursorscope listening on http://localhost:${port}`);
  console.log("OTel export config:", getOtelExportConfig());
  maybeStartCursorApiPolling();
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  stopCursorApiPolling();

  await new Promise((resolve) => server.close(resolve));
  await shutdownTelemetry();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
