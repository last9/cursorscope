import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

test("legacy JS entry delegates to the same transport and reads stdin through EOF", async (t) => {
  let receive;
  const received = new Promise((resolve) => { receive = resolve; });
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { receive({ body, type: req.headers["content-type"] }); res.end("{}"); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const child = spawn(process.execPath, ["scripts/cursor-hook-forwarder.js", "preToolUse"], {
    env: { ...process.env, CURSOR_HOOK_ENDPOINT: `http://127.0.0.1:${server.address().port}/cursor/hooks` },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.resume();
  const done = new Promise((resolve) => child.on("close", resolve));
  child.stdin.end('{"hook_event_name":"preToolUse"}');
  assert.equal(await done, 0);
  const request = await received;
  assert.equal(request.type, "application/x-www-form-urlencoded");
  assert.equal(new URLSearchParams(request.body).get("hook_input"), '{"hook_event_name":"preToolUse"}');
  assert.deepEqual(JSON.parse(output), { permission: "allow" });
});
