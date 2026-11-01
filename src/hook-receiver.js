import express from "express";

// Enrich in the long-lived ingestor instead of starting a JS runtime for every hook.
function enrichHookInput({ hook_input = "", user, repo, event }) {
  let input = {};
  if (hook_input.trim()) {
    try {
      input = JSON.parse(hook_input);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        input = { raw_stdin: hook_input };
      }
    } catch {
      input = { raw_stdin: hook_input };
    }
  }
  const name = input.hook_event_name || event || "cursor.hook.unknown";
  return {
    event_name: name,
    hook_event_name: name,
    source: "cursor_hook",
    ts: new Date().toISOString(),
    user: input.user_email || user || "unknown",
    repo: input.workspace_roots?.[0] || repo,
    conversation_id: input.conversation_id ?? null,
    generation_id: input.generation_id ?? null,
    session_id: input.session_id ?? input.conversation_id ?? null,
    model: input.model ?? null,
    cursor_version: input.cursor_version ?? null,
    workspace_roots: input.workspace_roots ?? [],
    data: input
  };
}

export function createHookRouter(recordHookEvent) {
  const router = express.Router();
  router.post("/cursor/hooks",
    express.json({ limit: "1mb" }),
    // Percent encoding can triple the raw payload size; leave room for metadata.
    express.urlencoded({ extended: false, limit: "4mb", parameterLimit: 4 }),
    (req, res) => {
      try {
        const event = req.is("application/x-www-form-urlencoded")
          ? enrichHookInput(req.body)
          : req.body || {};
        recordHookEvent({ ...event, source: event.source || "cursor_hook" });
        res.status(202).json({ accepted: true });
      } catch (error) {
        console.error("Failed to process hook event:", error);
        res.status(500).json({ accepted: false, error: error.message });
      }
    });
  return router;
}
