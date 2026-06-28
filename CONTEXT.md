# cursorscope

OpenTelemetry exporter for Cursor IDE: hooks and optional API polling become traces, metrics, and logs on any OTLP backend.

## Language

**Behavior plane**:
Real-time telemetry from Cursor lifecycle hooks — sessions, prompts, tool/MCP calls, subagents, durations, line edits, and estimated context tokens.
_Avoid_: Real-time plane, operational telemetry, hooks-only

**Billing plane**:
Authoritative usage and spend from Cursor's usage APIs (Admin API or opt-in dashboard fallback) — billed tokens, charged dollars, billing category, headless vs IDE-attached.
_Avoid_: Financial plane, authoritative plane, API-only

**Estimated context tokens**:
Token counts derived from hook payloads (chars/4 or MCP-reported usage) — measures context flowing through tools, not what Cursor bills.
_Avoid_: Billing tokens, LLM tokens (when meaning billed usage)

**Billing metrics**:
Event-level spend and billed token totals from `filtered-usage-events`, exported as **calendar-day gauges** (not per-event counters); billing plane, prefix `cursor.billing.*`.
_Avoid_: Activity metrics, estimated spend, cumulative billing counters

**Activity metrics**:
Per-user, per-day usage rollups from `daily-usage-data`; behavior plane, prefix `cursor.activity.*`; exported as **calendar-day gauges**.
_Avoid_: Billing metrics, daily billing

**Billing day**:
Calendar date (`YYYY-MM-DD`) that gauges roll up to; derived from event timestamp in **billing timezone** (default UTC). Exported as OTel label `cursor.billing_day`.
_Avoid_: Poll window, rolling window, `cursor.date` (ambiguous)

**Billing refresh window**:
On each poll, re-aggregate the last N complete **billing days** (default 3) plus incremental events since checkpoint; corrects late Cursor amendments without full 30-day re-pull every hour.
_Avoid_: Full backfill, incremental-only

**Billing timezone**:
IANA timezone for **billing day** bucketing (env `CURSOR_BILLING_TIMEZONE`, default `UTC`); align with how the team reads the Cursor dashboard.
_Avoid_: Server timezone (implicit), local time (unqualified)

**Charged spend**:
Total dollars Cursor bills for usage in a **billing day** bucket (`chargedCents / 100`); reconciles with the Cursor dashboard.
_Avoid_: Model cost, token fee (when meaning the full charge)

**Model cost**:
Dollars for model inference only in a **billing day** bucket (`tokenUsage.totalCents / 100`); excludes Cursor Token Rate.
_Avoid_: Charged spend, total cost

**Cursor token fee**:
Cursor's markup in dollars in a **billing day** bucket (`cursorTokenFee / 100` when present).
_Avoid_: Model cost, platform fee (generic)

**Chargeable usage**:
Usage Cursor marks as billable (`isChargeable: true`); spend gauges split by `chargeable` label so included-plan volume does not inflate FinOps spend charts.
_Avoid_: Free usage, included (as a metric name)

**Billing source**:
Which Cursor usage API feeds **billing metrics**: `admin` (Enterprise Admin API), `dashboard` (local session cookie), or `auto` (admin when key present, else dashboard).
_Avoid_: API mode, polling backend

**Dashboard session auth**:
Read-only `cursorAuth/accessToken` from local Cursor `state.vscdb` via `node:sqlite` (Node ≥22.5) with `sqlite3` CLI fallback; single warn if both unavailable — no token logged or uploaded.
_Avoid_: better-sqlite3 dependency, remote token storage

**Poll checkpoint**:
Durable poll cursor at `$CURSORSCOPE_HOME/.cursor-api-checkpoint.json` (`lastSuccessfulPollEndMs`); shared by billing and activity polls; advanced only after a full successful tick.
_Avoid_: Per-endpoint checkpoints, in-memory-only cursor

**Billing day bucketing**:
Shared `cursor-billing-day.js` converts event timestamps and activity `day` fields to OTel label `cursor.billing_day` using **billing timezone**.
_Avoid_: Per-poller date math, implicit UTC

**Gauge labels**:
OTel attributes on day gauges use the `cursor.*` namespace (`cursor.billing_day`, `cursor.user.email`, `cursor.billing.kind`, `cursor.is_headless`, `cursor.chargeable`, `cursor.billing.source`); model uses `gen_ai.request.model`. Email masking follows `CURSOR_MASK_USER_EMAIL`.
_Avoid_: Short keys (`billing_day`, `user_email`), `cursor.date`, `cursor.is_chargeable`

## Relationships

- **Behavior plane** carries hooks, **estimated context tokens**, and **activity metrics** (day gauges)
- **Billing plane** carries **billing metrics** (day gauges) from `filtered-usage-events` only
- **Activity metrics** require **billing source** `admin` or `auto` with a key (dashboard API does not provide `daily-usage-data`)
- **Billing source** `dashboard` yields **billing metrics** only (single user); **activity metrics** are not available without admin
- **Billing source** `auto` prefers admin when `CURSOR_ADMIN_API_KEY` is set; never double-polls both in one run
- Gauges are keyed by `cursor.billing_day` + dimensions (`cursor.user.email`, `gen_ai.request.model`, `cursor.billing.kind`, `cursor.is_headless`, `cursor.chargeable`, `cursor.billing.source`)
- Spend gauges (`charged_usd`, `model_cost_usd`, `cursor_token_fee_usd`) always include `cursor.chargeable`; token volume gauges do not
- `cursor.user.email` on day gauges respects `CURSOR_MASK_USER_EMAIL` via `maskEmail()` (same as hooks)
- On token-based usage in a bucket: **charged spend** ≈ **model cost** + **cursor token fee** (when fee is reported)
- Request-based usage may have **charged spend** without token breakdown
- Re-polling the same **billing day** overwrites gauge values (idempotent), never double-counts
- Day gauges use **named OTel instruments** per metric (e.g. `cursor.billing.charged_usd`), not one gauge with a `metric_name` label
- **Behavior plane** and **Billing plane** are independent; both export via OTLP (behavior also exports traces/logs)
- A single Cursor interaction may appear on both planes with no guaranteed join key today
- One API orchestrator may poll both endpoints, but emission stays on the correct plane

## Example dialogue

> **Dev:** "Why does `cursor_attributed_context_tokens_total` not match the Cursor dashboard?"
> **Domain expert:** "That's **estimated context tokens** on the **behavior plane**. **Billing metrics** from `chargedCents` are what reconcile with the dashboard."
>
> **Dev:** "Where do `agentRequests` from the Admin API go?"
> **Domain expert:** "**Activity metrics** on the **behavior plane** — not **billing metrics**."

## Flagged ambiguities

- Legacy `cursor_api_metric_value` / `observeCursorApiMetric` — resolved: remove in favor of `cursor.billing.*` and `cursor.activity.*` day gauges
- Cloud vs self-hosted hosting breakdown — deferred: v1 uses `is_headless` only; optional multi-pass `hostingType` poll later
