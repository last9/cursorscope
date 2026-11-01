# cursorscope

![cursorscope](assets/hero.png)

Cursor generates a lot of signal. Sessions, prompts, tool calls, model switches, compactions, subagents. None of it goes anywhere by default. cursorscope fixes that.

It's a small Node.js service that intercepts Cursor's hook events and exports them as OpenTelemetry traces, metrics, and logs to any OTLP-compatible backend. Last9, Grafana Cloud, Honeycomb, Datadog, Jaeger, a local Collector — whatever you already run. You get full observability into how your team uses Cursor: which models they reach for, how long agent loops run, where tools fail, how token budgets are spent.

## How it works

Cursor fires lifecycle hooks (`sessionStart`, `beforeSubmitPrompt`, `preToolUse`, etc.) as JSON on stdin to a shell script. That script returns a permissive response, drains stdin through EOF, and sends the payload to the local HTTP ingestor with background `curl`. Payload enrichment runs in the ingestor; ordinary hooks start no Node process and make no health requests. The ingestor maps hook events onto OTel spans — correlating by conversation ID and generation ID so tool calls nest correctly inside their parent prompt spans — and exports everything via OTLP.

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

Startup and version checks run in the background only on `sessionStart`. Export `CURSORSCOPE_AUTO_START=false` in Cursor's environment if you prefer `npm start` by hand. If the daemon stops during a session, start it manually or open a new session.

### Choose forwarded events

The lean default includes session, prompt, tool, shell, MCP, subagent, file-edit, response, stop, and compaction events. `afterAgentThought`, `beforeReadFile`, and `afterTabFileEdit` are opt-in; omitting them reduces telemetry volume and per-event work. Tool start/end pairs remain enabled.

```bash
# All 19 supported events, including thought/read/tab events
CURSORSCOPE_HOOK_EVENTS=all npm run install:global-hooks

# Explicit selection: whitespace or commas separate event names
CURSORSCOPE_HOOK_EVENTS='sessionStart,sessionEnd,beforeSubmitPrompt,preToolUse,postToolUse,postToolUseFailure,stop' npm run install:global-hooks

# Restore the lean default
npm run install:global-hooks
```

The same environment variable works with `npx @last9/cursorscope hooks install`. Reinstalling replaces cursorscope's previous selection, including removing deselected events, and preserves other hooks. Keep `sessionStart` in custom selections for automatic startup, and keep start/end pairs for complete spans. Unknown event names are rejected.

After upgrading, **reinstall hooks and restart the ingestor** (`npm run restart`, or the CLI's `stop` then `start`). The installed commands now pass the event name explicitly. Custom commands should invoke `scripts/cursorscope-forward.sh EVENT`; the legacy JS entry remains compatible but still starts Node.

### Delivery and latency

Permission hooks return `{"permission":"allow"}`, prompt submission returns `{"continue":true}`, and other events return `{}`. Network and startup failures never deny a Cursor action. These responses follow the [Cursor hook schemas](https://cursor.com/docs/hooks).

Forwarding is best effort: no durable queue or retry. The sender drains stdin into a private temporary file, capped at 1 MiB, and reads until EOF with a one-second safety deadline for a stuck producer; incomplete or oversized input is dropped. Reading large inputs takes longer than the small-payload benchmark below. The HTTP request runs after stdin is drained, in the background, with a 200 ms connection timeout and 500 ms total timeout. The temporary file is removed after delivery or failure. Output pipes are closed so Cursor does not wait for HTTP completion. Events during daemon startup or an outage may be lost; start the ingestor before a session when capturing its earliest events matters.

`CURSOR_HOOK_ENDPOINT` overrides the destination; otherwise it is `http://127.0.0.1:${PORT:-4327}/cursor/hooks`. The updated ingestor accepts form-encoded `hook_input`, `user`, `repo`, and `event`, reconstructs the same telemetry fields (including all original input under `data`), and stamps receipt time. Existing JSON envelopes remain accepted. Point custom endpoints at an ingestor that supports the new transport.

### Hook benchmark

From the repository root:

```bash
# Install hooks in a temporary HOME and test against an isolated healthy HTTP sink
CURSORSCOPE_HOOK_EVENTS=all node scripts/benchmark-hooks.js --runs 30 --budget-ms 20

# Overlap senders without waiting for background delivery between samples
CURSORSCOPE_HOOK_EVENTS=all node scripts/benchmark-hooks.js --runs 30 --burst --budget-ms 75

# Optional: execute every command in an existing hooks file (including custom hooks)
node scripts/benchmark-hooks.js --hooks "$HOME/.cursor/hooks.json" --runs 30
```

The JSON report includes p50/p95 wall time per command and health/event request counts. Timing includes process startup, stdin, exit, and output-pipe closure, but excludes background delivery. By default the generated-hook benchmark waits for delivery **outside** each timed sample before starting the next; `--burst` measures overlapping senders. `--hooks` executes the supplied commands without this delivery barrier. The fixture exports no OTLP data and does not start a real daemon; it isolates forwarding cost. A missed delivery or exceeded budget fails the generated-hook benchmark.

Measured on a shared Linux runner with Node 24.22.1, 30 small sample payloads per event, healthy fixture: the isolated-call **p95 budget is 20 ms**. Before is the original Node forwarding chain; after uses the buffered shell sender. All 570 events arrived in both runs; health requests fell from 1,140 to 30 (one per `sessionStart`). The slowest isolated p95 was 23.2 ms, above the 20 ms target; the buffering fix trades some small-input overhead for reliable large-payload delivery. Test spies also verify that none of the installed hook commands starts Node against a healthy ingestor.

| Event | Before p50 / p95 (ms) | After p50 / p95 (ms) |
|---|---:|---:|
| `sessionStart` | 358.7 / 402.6 | 13.1 / 14.9 |
| `sessionEnd` | 355.9 / 417.7 | 13.0 / 15.3 |
| `beforeSubmitPrompt` | 349.5 / 387.8 | 12.2 / 14.2 |
| `preToolUse` | 350.4 / 382.9 | 12.4 / 14.6 |
| `postToolUse` | 348.4 / 405.8 | 12.5 / 17.0 |
| `postToolUseFailure` | 347.3 / 386.8 | 12.7 / 23.2 |
| `beforeShellExecution` | 363.4 / 434.7 | 12.9 / 15.2 |
| `afterShellExecution` | 343.0 / 377.9 | 12.7 / 16.6 |
| `beforeMCPExecution` | 351.9 / 378.4 | 12.6 / 16.2 |
| `afterMCPExecution` | 350.3 / 394.4 | 13.6 / 15.6 |
| `afterFileEdit` | 345.3 / 376.0 | 12.7 / 15.3 |
| `subagentStart` | 388.1 / 468.3 | 12.8 / 15.9 |
| `subagentStop` | 369.4 / 412.7 | 12.2 / 16.1 |
| `afterAgentResponse` | 366.4 / 451.0 | 13.7 / 16.8 |
| `stop` | 376.1 / 433.1 | 12.7 / 14.4 |
| `preCompact` | 363.4 / 388.9 | 13.1 / 21.3 |
| `beforeReadFile` | 350.7 / 394.9 | 13.1 / 15.7 |
| `afterTabFileEdit` | 397.6 / 486.5 | 13.1 / 15.4 |
| `afterAgentThought` | 350.8 / 394.2 | 12.9 / 14.6 |

The unpaced burst run also delivered all 570 events. Ordinary-hook p95 reached 48.8 ms; repeated `sessionStart` p95 reached 55.9 ms. That passes the separate 75 ms burst budget, but does **not** meet the isolated 20 ms target under sustained overlapping load. These are runner measurements, not a latency guarantee for larger payloads or other machines.

### Per-project hooks

Point Cursor at `.cursor/hooks.json` in this repo. Hooks call `.cursor/hooks/forward.sh EVENT`, which uses the same sender and lean defaults as global hooks. Edit the event entries in `.cursor/hooks.json` to customize this project; keep the matching event argument. Only `sessionStart` auto-starts the ingestor.

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

Node.js 22.23.4+, 24.22.1+ or 26.12.1+. These are the first releases on each line that reject TLS chains through the compromised eMudhra intermediates, which matters because exports go over OTLP/HTTPS. No build step. Hook forwarding requires Bash and curl; global hook installation also requires Python 3.
