#!/usr/bin/env node

/**
 * Cursor hook forwarder: reads hook JSON from stdin, enriches, posts to local ingestor.
 */

const hookEndpoint = process.env.CURSOR_HOOK_ENDPOINT || "http://localhost:8787/cursor/hooks";
const readStdin =
  process.env.CURSOR_HOOK_READ_STDIN !== "false" && process.env.CURSOR_HOOK_READ_STDIN !== "0";

const stdinBody = readStdin ? await readStdinPayload() : "";
let hookInput = {};

if (stdinBody.trim().length > 0) {
  try {
    hookInput = JSON.parse(stdinBody);
  } catch (_error) {
    hookInput = { raw_stdin: stdinBody };
  }
}

const hookEventName =
  hookInput.hook_event_name || process.env.CURSOR_HOOK_EVENT || "cursor.hook.unknown";

const payload = {
  event_name: hookEventName,
  hook_event_name: hookEventName,
  source: "cursor_hook",
  ts: new Date().toISOString(),
  user: hookInput.user_email || process.env.USER || "unknown",
  repo: hookInput.workspace_roots?.[0] || process.cwd(),
  conversation_id: hookInput.conversation_id ?? null,
  generation_id: hookInput.generation_id ?? null,
  session_id: hookInput.session_id ?? hookInput.conversation_id ?? null,
  model: hookInput.model ?? null,
  cursor_version: hookInput.cursor_version ?? null,
  workspace_roots: hookInput.workspace_roots ?? [],
  data: hookInput
};

try {
  const response = await fetch(hookEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Hook forward failed (${response.status}): ${body}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Hook forward failed:", error.message);
  process.exitCode = 1;
}

function readStdinPayload() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY || process.stdin.readableEnded) {
      resolve("");
      return;
    }

    let data = "";
    const timer = setTimeout(() => {
      cleanup();
      resolve(data);
    }, 100);

    function cleanup() {
      clearTimeout(timer);
      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("end");
      process.stdin.removeAllListeners("error");
    }

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      cleanup();
      resolve(data);
    });
    process.stdin.on("error", () => {
      cleanup();
      resolve("");
    });
  });
}
