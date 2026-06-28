---
status: accepted
date: 2026-06-28
---

# Billing and activity telemetry use calendar-day gauges, not per-event counters

cursorscope ingests Cursor usage via **hourly API polling**, not a live event stream. We export **behavior plane** data (hooks + `daily-usage-data` activity) and **billing plane** data (`filtered-usage-events` spend) as **calendar-day gauges** — `cursor.activity.*` and `cursor.billing.*` — keyed by `billing_day`, user, model, and other dimensions. Each poll **recomputes and sets** absolute totals for each day bucket; re-polling is idempotent.

We rejected **per-event cumulative counters** (the pattern used by [whoburnedmore](https://github.com/amiinwani/whoburnedmore.com) for leaderboard aggregates). Counters increment on every event every poll, which requires perfect event-ID deduplication and fails loudly on partial pagination — whoburnedmore throws mid-pagination for exactly that reason. Polled batch data fits **gauges** better.

**Considered options:** (1) per-event OTLP counters + dedupe checkpoint — complex, fragile; (2) whoburnedmore-style daily aggregates only at CLI boundary — no OTLP; (3) **day gauges** — chosen.

**Consequences:** Dashboards must read gauge values directly (not `rate()` on billing spend). `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative` applies to hook counters, not billing gauges — document in README. Legacy `cursor_api_metric_value` is removed. Spend splits into three gauges (`charged_usd`, `model_cost_usd`, `cursor_token_fee_usd`) with a `chargeable` label for included vs billable usage.

See also: `CONTEXT.md`, `docs/plans/2026-06-28-001-feat-cursor-billing-truth-plan.md`.
