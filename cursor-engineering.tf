# Cursor — Engineering Productivity dashboard
# Built on cursorscope OTel cumulative counters; all queries use last_over_time.
# Region: aps1 (otlp-aps1.last9.io). Window: 10080 min (7 days).

terraform {
  required_providers {
    last9 = {
      source  = "last9/last9"
      version = ">= 0.3, < 1.0"
    }
  }
}

resource "last9_dashboard" "cursor_engineering" {
  region        = "aps1"
  name          = "Cursor — Engineering Productivity"
  relative_time = 10080

  metadata {
    category = "custom"
    type     = "metrics"
    tags     = ["cursor", "engineering", "productivity", "otel"]
  }

  variable {
    display_name   = "User"
    target         = "cursor_user"
    type           = "label"
    source         = "cursor_user"
    matches        = ["cursor_hook_events_total{cursor_user=~\".+\"}"]
    multiple       = false
    current_values = [".*"]
  }

  # ── Section: Overview ─────────────────────────────────────────────────────
  panel {
    name = "Overview"
    visualization {
      type       = "section"
      full_width = true
    }
  }

  panel {
    name = "Sessions"
    unit = ""
    layout {
      x = 0
      y = 0
      w = 2
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_session_total{cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Sessions"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Prompts"
    unit = ""
    layout {
      x = 2
      y = 0
      w = 2
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_prompt_total{cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Prompts"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Lines Added"
    unit = ""
    layout {
      x = 4
      y = 0
      w = 2
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_lines_of_code_total{type=\"added\",cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Lines Added"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Lines Removed"
    unit = ""
    layout {
      x = 6
      y = 0
      w = 2
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_lines_of_code_total{type=\"removed\",cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Lines Removed"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Net Lines"
    unit = ""
    layout {
      x = 8
      y = 0
      w = 2
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_lines_of_code_total{type=\"added\",cursor_user=~\"$cursor_user\"}[$__range]))) - sum(max without(key_l9_collecor_id) (last_over_time(cursor_lines_of_code_total{type=\"removed\",cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Net Lines"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Tool Executions"
    unit = ""
    layout {
      x = 10
      y = 0
      w = 2
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_tool_executions_total{cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Tools"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "MCP Invocations"
    unit = ""
    layout {
      x = 0
      y = 3
      w = 4
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_mcp_invocations_total{cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "MCP Calls"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Hook Events"
    unit = ""
    layout {
      x = 4
      y = 3
      w = 4
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_hook_events_total{cursor_user=~\"$cursor_user\"}[$__range])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Hook Events"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Tool Error Rate"
    unit = "percent"
    layout {
      x = 8
      y = 3
      w = 4
      h = 3
    }
    visualization {
      type = "stat"
    }
    query {
      name             = "A"
      expr             = "sum(max without(key_l9_collecor_id) (last_over_time(cursor_tool_executions_total{success=\"false\",cursor_user=~\"$cursor_user\"}[$__range]))) / sum(max without(key_l9_collecor_id) (last_over_time(cursor_tool_executions_total{cursor_user=~\"$cursor_user\"}[$__range]))) * 100"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "custom"
      legend_value     = "Error %"
      legend_placement = "bottom"
    }
  }

  # ── Section: Activity ─────────────────────────────────────────────────────
  panel {
    name = "Activity"
    visualization {
      type       = "section"
      full_width = true
    }
  }

  panel {
    name = "Hook Events — by Type"
    unit = ""
    layout {
      x = 0
      y = 6
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "line"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (cursor_hook_name) (max without(key_l9_collecor_id) (last_over_time(cursor_hook_events_total{cursor_user=~\"$cursor_user\",cursor_hook_name!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Hook Events — by User"
    unit = ""
    layout {
      x = 6
      y = 6
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (cursor_user) (max without(key_l9_collecor_id) (last_over_time(cursor_hook_events_total{cursor_user=~\"$cursor_user\",cursor_user!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  # ── Section: Code Output ──────────────────────────────────────────────────
  panel {
    name = "Code Output"
    visualization {
      type       = "section"
      full_width = true
    }
  }

  panel {
    name = "Lines Added — by User"
    unit = ""
    layout {
      x = 0
      y = 11
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (cursor_user) (max without(key_l9_collecor_id) (last_over_time(cursor_lines_of_code_total{type=\"added\",cursor_user=~\"$cursor_user\",cursor_user!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Lines Added — by File Extension"
    unit = ""
    layout {
      x = 6
      y = 11
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (file_extension) (max without(key_l9_collecor_id) (last_over_time(cursor_lines_of_code_total{type=\"added\",cursor_user=~\"$cursor_user\",file_extension!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  # ── Section: Tool Executions ──────────────────────────────────────────────
  panel {
    name = "Tool Executions"
    visualization {
      type       = "section"
      full_width = true
    }
  }

  panel {
    name = "Tool Executions — by Tool"
    unit = ""
    layout {
      x = 0
      y = 16
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "line"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (tool_name) (max without(key_l9_collecor_id) (last_over_time(cursor_tool_executions_total{cursor_user=~\"$cursor_user\",tool_name!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Tool Failures — by Tool"
    unit = ""
    layout {
      x = 6
      y = 16
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (tool_name) (max without(key_l9_collecor_id) (last_over_time(cursor_tool_executions_total{success=\"false\",cursor_user=~\"$cursor_user\",tool_name!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Tool Latency p95 — by Tool"
    unit = "seconds"
    layout {
      x = 0
      y = 21
      w = 12
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "line"
      }
    }
    query {
      name             = "A"
      expr             = "histogram_quantile(0.95, sum by (gen_ai_tool_name, le) (rate(gen_ai_client_operation_duration_seconds_bucket{service_name=\"cursorscope\",cursor_user=~\"$cursor_user\",gen_ai_tool_name!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  # ── Section: MCP Invocations ──────────────────────────────────────────────
  panel {
    name = "MCP Invocations"
    visualization {
      type       = "section"
      full_width = true
    }
  }

  panel {
    name = "MCP Calls — by Tool"
    unit = ""
    layout {
      x = 0
      y = 26
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (mcp_tool) (max without(key_l9_collecor_id) (last_over_time(cursor_mcp_invocations_total{cursor_user=~\"$cursor_user\",mcp_tool!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Sessions — by Composer Mode"
    unit = ""
    layout {
      x = 6
      y = 26
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (composer_mode) (max without(key_l9_collecor_id) (last_over_time(cursor_session_total{cursor_user=~\"$cursor_user\",composer_mode!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  # ── Section: Context Attribution ─────────────────────────────────────────
  panel {
    name = "Context Attribution"
    visualization {
      type       = "section"
      full_width = true
    }
  }

  panel {
    name = "Context Tokens — by Attribution Category"
    unit = ""
    layout {
      x = 0
      y = 31
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (attribution_category) (max without(key_l9_collecor_id) (last_over_time(cursor_attributed_context_tokens_total{cursor_user=~\"$cursor_user\",attribution_category!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }

  panel {
    name = "Attribution Invocations — by Category"
    unit = ""
    layout {
      x = 6
      y = 31
      w = 6
      h = 5
    }
    visualization {
      type = "timeseries"
      timeseries_config {
        display_type = "area"
      }
    }
    query {
      name             = "A"
      expr             = "sum by (attribution_category) (max without(key_l9_collecor_id) (last_over_time(cursor_attribution_invocations_total{cursor_user=~\"$cursor_user\",attribution_category!=\"\"}[$__interval])))"
      telemetry        = "metrics"
      query_type       = "promql"
      legend_type      = "auto"
      legend_placement = "bottom"
    }
  }
}
