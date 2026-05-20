# cursorscope

![cursorscope](assets/hero.png)

Cursor generates a lot of signal. Sessions, prompts, tool calls, model switches, compactions, subagents. None of it goes anywhere by default. cursorscope fixes that.

It's a small Node.js service that intercepts Cursor's hook events and exports them as OpenTelemetry traces, metrics, and logs to any OTLP-compatible backend. Last9, Grafana Cloud, Honeycomb, Datadog, Jaeger, a local Collector — whatever you already run. You get full observability into how your team uses Cursor: which models they reach for, how long agent loops run, where tools fail, how token budgets are spent.

## How it works

Cursor fires lifecycle hooks (`sessionStart`, `beforeSubmitPrompt`, `preToolUse`, etc.) as JSON on stdin to a shell script. That script hands the payload to a Node forwarder, which posts it to a local HTTP ingestor. The ingestor maps hook events onto OTel spans — correlating by conversation ID and generation ID so tool calls nest correctly inside their parent prompt spans — and exports everything via OTLP.

The result is a proper distributed trace for every agent interaction: session span at the root, prompt spans as children, tool call spans underneath those, subagent spans branching off when Cursor fans out work.

## Backends

cursorscope speaks OTLP HTTP. Point it anywhere:

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://your-backend/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=https://your-backend/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://your-backend/v1/logs
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <your-token>
```

| Backend | Notes |
|---------|-------|
| [Last9](https://app.last9.io/integrations?category=all&integration=OpenTelemetry) | Guided setup via `npx @last9/cursorscope` |
| Grafana Cloud | OTLP endpoint + basic auth from your stack settings |
| Honeycomb | `api.honeycomb.io:443`, header `x-honeycomb-team=<api-key>` |
| Datadog | OTLP Agent endpoint `localhost:4318` via local Datadog Agent |
| Jaeger / Tempo | Local collector or direct OTLP endpoint |
| Local Collector | `docker compose up -d` — see [With an OTel Collector](#with-an-otel-collector) |

## Setup

### Last9

One command installs to `~/.cursorscope`, writes `.env`, registers global Cursor hooks, and starts the ingestor:

```bash
npx @last9/cursorscope
```

Interactive setup opens [Last9 → OpenTelemetry integration](https://app.last9.io/integrations?category=all&integration=OpenTelemetry) so you can copy the OTLP endpoint and Basic auth token.

**Note:** The OTLP auth token is only visible to Last9 organization admins. If you're not an admin, ask yours to copy it from the integration page.

Non-interactive:

```bash
npx @last9/cursorscope setup --last9 \
  --otlp-base <your-last9-otlp-endpoint> \
  --auth-token "$LAST9_OTLP_TOKEN"
```

### Any other OTLP backend

```bash
npx @last9/cursorscope setup
```

This runs the same guided flow without the Last9 preset — you supply your own endpoints and auth headers.

### After setup

Restart Cursor and send one Agent message. The ingestor starts automatically in the background.

If you ever need to intervene:

```bash
npx @last9/cursorscope status        # health check — is the ingestor running?
npx @last9/cursorscope start         # start it manually if auto-start failed
npx @last9/cursorscope hooks install # re-register Cursor hooks after a Cursor update
```

## Manual setup

For contributors or anyone who wants full control.

Clone and install:

```bash
git clone https://github.com/last9/cursorscope.git
cd cursorscope
npm install
```

Copy the env file and fill in your OTLP destination:

```bash
# run from repo root
cp .env.example .env
```

The minimum to export to a remote backend:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otlp-endpoint
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64-credentials>
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
```

### Auto-start (recommended)

Install global hooks once — merges into `~/.cursor/hooks.json` without touching your existing hooks (`rtk`, custom scripts, etc.). A timestamped backup is created first.

```bash
# run from repo root
npm run install:global-hooks
```

Restart Cursor and open a new chat. The ingestor starts in the background automatically. Logs at `~/.cursor/cursorscope.log`.

```bash
# run from repo root
npm run stop                    # stop the background ingestor
npm run uninstall:global-hooks  # remove only cursorscope hook entries
```

Set `CURSORSCOPE_AUTO_START=false` in `.env` if you prefer `npm start` by hand.

Register all hook types (optional): `CURSORSCOPE_HOOK_EVENTS=all npm run install:global-hooks`

### Per-project hooks

Point Cursor at `.cursor/hooks.json` in this repo. Hooks call `.cursor/hooks/forward.sh`, which auto-starts the ingestor and forwards events.

### Manual start

```bash
# run from repo root
npm start
```

For a central install, set `CURSORSCOPE_HOME` and `CURSOR_HOOK_ENDPOINT` to your running service URL.

## With an OTel Collector

To fan out to multiple backends or pre-process telemetry, run the included Collector:

```bash
docker compose up -d
```

This starts `otel/opentelemetry-collector-contrib` on `localhost:4317` (gRPC) and `localhost:4318` (HTTP). The local config (`otel/collector.local.yaml`) sends everything to the debug exporter so you can see what's being emitted. Swap in `otel/collector.last9.yaml` or write your own to route to a real backend.

## Cursor Admin API polling

Cursor Business accounts can unlock team-level daily usage metrics — requests, tokens, model breakdowns — exported as OTel gauges:

```
ENABLE_CURSOR_API_POLLING=true
CURSOR_ADMIN_API_KEY=<your-key>
CURSOR_TEAM_ID=<your-team-id>
CURSOR_API_POLL_INTERVAL_MS=300000
```

## Privacy

User prompts are redacted by default — only prompt length is recorded. Set `CURSOR_LOG_USER_PROMPTS=true` to include prompt text in spans and logs. API keys and bearer tokens are scrubbed automatically regardless. Set `CURSOR_MASK_USER_EMAIL=true` to mask `cursor.user.email` before it leaves your machine.

## What you get

**Traces** — one root span per session, one span per prompt/generation, tool call spans as children with duration and success/failure, subagent spans branching from parent conversations.

**Metrics** — `cursor_hook_events_total`, `cursor_session_total`, `cursor_prompt_total`, `cursor_tool_executions_total`, `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `cursor_api_metric_value` (Admin API polling).

**Logs** — one structured log record per hook event with conversation ID, model, and hook-specific fields.

Attribute names follow the [OTel GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) where applicable.

## Debug endpoints

```
GET  /healthz               — liveness check
GET  /debug/otel-config     — show resolved OTLP endpoints and config
POST /debug/emit-and-flush  — emit a test trace/metric/log and force flush
GET  /debug/otlp-probe      — probe connectivity to all configured OTLP endpoints
```

## Requirements

Node.js 20 or later. No build step.
