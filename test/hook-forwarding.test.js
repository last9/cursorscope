import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const script = path.join(root, "scripts/cursorscope-forward.sh");
async function fixture(t, handler) {
  const home = await mkdtemp(path.join(tmpdir(), "cursorscope-forward-"));
  await mkdir(path.join(home, "bin"));
  // Any attempt to start Node on the per-event path is a regression, even in the background.
  await writeFile(path.join(home, "bin/node"), '#!/bin/sh\necho node >> "$HOME/node-starts"\nexit 99\n', { mode: 0o755 });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    // Every exit path must release the private spool, including curl failures.
    let files;
    for (let i = 0; i < 100; i++) {
      files = (await readdir(home)).filter((name) => name.startsWith("cursorscope-hook."));
      if (!files.length) break;
      await delay(10);
    }
    assert.deepEqual(files, [], "payload spool leaked");
    await rm(home, { recursive: true, force: true });
  });
  const env = { ...process.env, HOME: home, TMPDIR: home, CURSORSCOPE_HOME: root,
    PATH: `${home}/bin:${process.env.PATH}`, USER: 'test user & "quotes"',
    PORT: String(server.address().port), CURSORSCOPE_AUTO_START: "true",
    CURSOR_HOOK_ENDPOINT: `http://127.0.0.1:${server.address().port}/cursor/hooks` };
  return { home, server, env };
}
function forward(env, event, input, { stdin } = {}) {
  const child = spawn(script, [event], { env, cwd: root, stdio: [stdin || "pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  if (!stdin) {
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  }
  const result = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  return { child, result };
}
async function eventually(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), "background delivery did not complete");
}

test("forwarder returns before the HTTP response, preserves input and never starts Node", async (t) => {
  let request, respond;
  let responseClosed = false;
  const { env, home } = await fixture(t, (req, res) => {
    res.on("close", () => { responseClosed = true; });
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { request = { url: req.url, body }; respond = () => res.end("{}"); });
  });
  const payload = JSON.stringify({ hook_event_name: "preToolUse", tool_input: "é\n&=+\\", nested: { a: [1, 2] } });
  const { result } = forward(env, "preToolUse", payload);
  const output = await result;
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), { permission: "allow" });
  await eventually(() => request);
  assert.equal(responseClosed, false, "the hook waited for the sender to time out");
  assert.equal(request.url, "/cursor/hooks");
  const form = new URLSearchParams(request.body);
  assert.equal(form.get("hook_input"), payload);
  assert.equal(form.get("user"), env.USER);
  assert.equal(form.get("repo"), root);
  assert.equal(form.get("event"), "preToolUse");
  respond();
  await assert.rejects(readFile(path.join(home, "node-starts")), { code: "ENOENT" });
});

test("blocking hooks fail open when the ingestor is down", async (t) => {
  const { env, home, server } = await fixture(t, (_req, res) => res.end());
  await new Promise((resolve) => server.close(resolve));
  for (const event of ["preToolUse", "beforeShellExecution", "beforeReadFile", "beforeMCPExecution"]) {
    const { result } = forward(env, event, JSON.stringify({ hook_event_name: event }));
    const output = await result;
    assert.equal(output.code, 0, output.stderr);
    assert.deepEqual(JSON.parse(output.stdout), { permission: "allow" });
    assert.equal(output.stderr, "");
  }
  await delay(100);
  await assert.rejects(readFile(path.join(home, "node-starts")), { code: "ENOENT" });
});

test("stdin arriving after 100ms is drained through EOF before exit", async (t) => {
  let body;
  const { env } = await fixture(t, (req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => { body = new URLSearchParams(data).get("hook_input"); res.end("{}"); });
  });
  // Use an independent writer: Node automatically destroys child.stdin when
  // the hook exits, unlike Cursor's stdin producer, which can still be writing.
  const writer = spawn("sh", ["-c", `printf '{"tool_name":'; read marker; printf '"Read"}'`],
    { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => writer.kill());
  const { result } = forward(env, "postToolUse", "", { stdin: writer.stdout });
  await delay(150);
  assert.equal(body, undefined);
  writer.stdin.end("done\n");
  const output = await result;
  assert.equal(output.code, 0, output.stderr);
  await eventually(() => body !== undefined);
  assert.equal(body, '{"tool_name":"Read"}');
});


test("large payloads are sent intact without the command-line argument size limit", async (t) => {
  let body;
  const { env } = await fixture(t, (req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => { body = new URLSearchParams(data).get("hook_input"); res.end("{}"); });
  });
  for (const size of [400014, 1048575, 1048576]) {
    body = undefined;
    const input = JSON.stringify({ content: "x".repeat(size - 14) });
    assert.equal(Buffer.byteLength(input), size);
    const { result } = forward(env, "afterFileEdit", input);
    assert.equal((await result).code, 0);
    await eventually(() => body !== undefined);
    assert.equal(body.length, input.length);
    assert.ok(body === input);
  }
});

test("input one byte over the limit is dropped without waiting for EOF", async (t) => {
  let requests = 0;
  const { env } = await fixture(t, (req, res) => { requests++; req.resume(); res.end("{}"); });
  const { child, result } = forward(env, "afterFileEdit", "", { stdin: "pipe" });
  child.stdin.on("error", () => {});
  child.stdin.write("x".repeat(1048577));
  const output = await result;
  assert.equal(output.code, 0);
  assert.equal(output.stderr, "");
  await delay(100);
  assert.equal(requests, 0);
});

test("stdin safety timeout drops incomplete input and releases the hook", async (t) => {
  let requests = 0;
  const { env } = await fixture(t, (req, res) => { requests++; req.resume(); res.end("{}"); });
  const writer = spawn("sh", ["-c", `printf '{"partial":'; read marker`],
    { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => writer.kill());
  const { result } = forward(env, "beforeSubmitPrompt", "", { stdin: writer.stdout });
  const output = await result;
  assert.deepEqual(JSON.parse(output.stdout), { continue: true });
  assert.equal(output.stderr, "");
  writer.stdin.end("done\n");
  assert.equal(requests, 0);
});

test("only sessionStart runs startup checks, in the background before delivery", async (t) => {
  let delivered = false;
  const { env, home } = await fixture(t, (req, res) => {
    req.resume(); req.on("end", () => { delivered = true; res.end("{}"); });
  });
  await mkdir(path.join(home, "scripts"));
  // Hold startup until the test releases it, making the ordering deterministic.
  await writeFile(path.join(home, "scripts/ensure-cursorscope.sh"),
    '#!/bin/sh\necho started > "$HOME/startup"\nwhile [ ! -f "$HOME/release" ]; do sleep 0.01; done\n', { mode: 0o755 });
  const { result } = forward({ ...env, CURSORSCOPE_HOME: home }, "sessionStart", "{}");
  assert.deepEqual(JSON.parse((await result).stdout), {});
  assert.equal(delivered, false);
  await writeFile(path.join(home, "release"), "");
  await eventually(() => delivered);
  assert.equal(await readFile(path.join(home, "startup"), "utf8"), "started\n");
});

test("small payloads bypass temporary files and preserve bytes at the buffering boundary", async (t) => {
  let body;
  const { env, home } = await fixture(t, (req, res) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => { body = new URLSearchParams(data).get("hook_input"); res.end("{}"); });
  });
  // Small hooks must not pay for a spool or its helper processes.
  await writeFile(path.join(home, "bin/mktemp"), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  for (const size of [0, 300, 1023]) {
    body = undefined;
    const payload = size ? JSON.stringify({ text: "x".repeat(size - 13) }) + "\n\n" : "";
    assert.equal(Buffer.byteLength(payload), size);
    const { result } = forward(env, "afterFileEdit", payload);
    assert.equal((await result).code, 0);
    await eventually(() => body !== undefined);
    assert.equal(body, payload);
  }
  await rm(path.join(home, "bin/mktemp"));
  for (const payload of ["x".repeat(1022) + "\n\n", "x".repeat(1023) + "\n\n",
    JSON.stringify({ text: "x".repeat(1014) + "é" })]) {
    // The UTF-8 character straddles the 1024-byte prefix/spool boundary.
    body = undefined;
    const { result } = forward(env, "afterFileEdit", payload);
    assert.equal((await result).code, 0);
    await eventually(() => body !== undefined);
    assert.equal(body, payload);
  }
});

test("stdin safety timeout also drops a stalled buffered payload", async (t) => {
  let requests = 0;
  const { env } = await fixture(t, (req, res) => { requests++; req.resume(); res.end("{}"); });
  const { child, result } = forward(env, "afterFileEdit", "", { stdin: "pipe" });
  child.stdin.on("error", () => {});
  child.stdin.write("x".repeat(2048));
  const output = await result;
  assert.equal(output.code, 0);
  assert.equal(output.stderr, "");
  assert.equal(requests, 0);
});
