#!/usr/bin/env node
// Measure hook caller latency against an isolated, healthy HTTP ingestor fixture.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const { values } = parseArgs({ options: {
  hooks: { type: "string" },
  runs: { type: "string", default: "50" },
  "budget-ms": { type: "string" },
  burst: { type: "boolean", default: false }
} });
const runs = Number(values.runs);
const budget = values["budget-ms"] === undefined ? null : Number(values["budget-ms"]);
if (!Number.isInteger(runs) || runs < 1 || (budget !== null && !(budget > 0))) {
  throw new Error("--runs must be a positive integer; --budget-ms must be positive");
}
const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const home = await mkdtemp(path.join(tmpdir(), "cursorscope-benchmark-"));
const requests = { health: 0, events: 0 };
const server = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url === "/healthz") {
      requests.health++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, version }));
    } else {
      requests.events++;
      res.writeHead(202).end('{"accepted":true}');
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const env = { ...process.env, HOME: home, CURSORSCOPE_HOME: root,
  CURSORSCOPE_AUTO_START: "true", PORT: String(port),
  CURSOR_HOOK_ENDPOINT: `http://127.0.0.1:${port}/cursor/hooks` };

function run(command, input = "") {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn("sh", ["-c", command], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.on("error", reject);
    // close includes inherited output pipes: a detached sender must close them too.
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Hook exited ${code}: ${command}\n${stderr}`));
      else resolve(performance.now() - start);
    });
  });
}

try {
  if (!values.hooks) await run('bash "$CURSORSCOPE_HOME/scripts/install-global-hooks.sh"');
  const hooksFile = values.hooks || path.join(home, ".cursor/hooks.json");
  const { hooks } = JSON.parse(await readFile(hooksFile, "utf8"));
  const results = [];
  for (const [event, entries] of Object.entries(hooks)) {
    for (const { command } of entries) {
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const priorEvents = requests.events;
        samples.push(await run(command, JSON.stringify({
          hook_event_name: event, conversation_id: "benchmark", generation_id: String(i),
          workspace_roots: [root], tool_name: "Read", model: "benchmark"
        })));
        // Compare idle, healthy caller latency with the old synchronous sender.
        // Delivery is outside the timed interval; --burst measures overlapping senders.
        if (!values.hooks && !values.burst) {
          const deadline = Date.now() + 5000;
          while (requests.events === priorEvents && Date.now() < deadline) await delay(10);
          if (requests.events === priorEvents) throw new Error(`Event not delivered: ${event}`);
        }
      }
      samples.sort((a, b) => a - b);
      results.push({ event, command, runs,
        p50_ms: samples[Math.ceil(runs * 0.5) - 1],
        p95_ms: samples[Math.ceil(runs * 0.95) - 1] });
    }
  }
  if (!results.length) throw new Error("No registered hook commands");
  const expected = results.length * runs;
  if (!values.hooks) {
    const deadline = Date.now() + 5000;
    while (requests.events < expected && Date.now() < deadline) await delay(10);
    if (requests.events !== expected) process.exitCode = 1;
  }
  console.log(JSON.stringify({ fixture: "healthy local HTTP sink (no OTLP export)",
    runs, burst: values.burst, budget_ms: budget, requests, results }, null, 2));
  if (budget !== null && results.some((row) => row.p95_ms >= budget)) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(home, { recursive: true, force: true });
}
