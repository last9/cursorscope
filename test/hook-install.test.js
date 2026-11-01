import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

function setup(t) {
  const home = mkdtempSync(path.join(tmpdir(), "cursorscope install's-"));
  mkdirSync(path.join(home, ".cursor"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const hooksFile = path.join(home, ".cursor/hooks.json");
  const install = (events = "") => {
    const result = spawnSync("bash", ["scripts/install-global-hooks.sh"], { encoding: "utf8",
      env: { ...process.env, HOME: home, CURSORSCOPE_HOME: process.cwd(), CURSORSCOPE_HOOK_EVENTS: events } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(hooksFile, "utf8")).hooks;
  };
  return { home, hooksFile, install };
}

test("default hook set omits noisy events and passes the event to the wrapper", (t) => {
  const { install } = setup(t);
  const hooks = install();
  for (const event of ["afterAgentThought", "beforeReadFile", "afterTabFileEdit"]) {
    assert.equal(hooks[event], undefined);
  }
  for (const event of ["sessionStart", "sessionEnd", "preToolUse", "postToolUse", "afterFileEdit", "stop"]) {
    assert.ok(hooks[event]);
  }
  for (const [event, entries] of Object.entries(hooks)) {
    assert.ok(entries[0].command.endsWith(` ${event}`));
  }
});

test("reinstall replaces the selected set, preserves other hooks and is idempotent", (t) => {
  const { hooksFile, install } = setup(t);
  writeFileSync(hooksFile, JSON.stringify({ version: 1, hooks: {
    beforeReadFile: [{ command: "user-file-hook" }],
    preToolUse: [{ command: "user-tool-hook" }]
  } }));
  const all = install("all");
  assert.equal(Object.keys(all).length, 19);
  assert.equal(all.beforeReadFile.length, 2);
  const selected = install("sessionStart, afterAgentThought");
  assert.deepEqual(selected.beforeReadFile, [{ command: "user-file-hook" }]);
  assert.deepEqual(selected.preToolUse, [{ command: "user-tool-hook" }]);
  assert.equal(selected.afterAgentThought.length, 1);
  assert.equal(selected.postToolUse, undefined);
  assert.deepEqual(install("sessionStart afterAgentThought"), selected);
});

test("unknown events fail before changing an existing installation", (t) => {
  const { home, hooksFile, install } = setup(t);
  install();
  const before = readFileSync(hooksFile, "utf8");
  const result = spawnSync("bash", ["scripts/install-global-hooks.sh"], { encoding: "utf8",
    env: { ...process.env, HOME: home, CURSORSCOPE_HOME: process.cwd(), CURSORSCOPE_HOOK_EVENTS: "notAnEvent" } });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(hooksFile, "utf8"), before);
});

test("project hook commands use the same lean set and identify each event", (t) => {
  const { install } = setup(t);
  const global = install();
  const project = JSON.parse(readFileSync(".cursor/hooks.json", "utf8")).hooks;
  assert.deepEqual(Object.keys(project), Object.keys(global));
  for (const [event, entries] of Object.entries(project)) {
    assert.equal(entries[0].command, `.cursor/hooks/forward.sh ${event}`);
  }
});


test("every installed hook delivers through the shared sender without starting Node", async (t) => {
  const { home, install } = setup(t);
  const hooks = install("all");
  const bin = path.join(home, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "node"), '#!/bin/sh\necho node >> "$HOME/node-starts"\nexit 99\n', { mode: 0o755 });
  let health = 0;
  const received = [];
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/healthz") { health++; res.end(JSON.stringify({ version })); }
      else { received.push(new URLSearchParams(body)); res.writeHead(202).end("{}"); }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = String(server.address().port);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
    PORT: port, CURSORSCOPE_HOME: process.cwd(), CURSORSCOPE_AUTO_START: "true",
    CURSOR_HOOK_ENDPOINT: `http://127.0.0.1:${port}/cursor/hooks` };
  for (const [event, entries] of Object.entries(hooks)) {
    const child = spawn("sh", ["-c", entries[0].command], { env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.resume();
    const done = new Promise((resolve) => child.on("close", resolve));
    child.stdin.end(JSON.stringify({ hook_event_name: event }));
    assert.equal(await done, 0);
    const expected = /^(preToolUse|beforeShellExecution|beforeReadFile|beforeMCPExecution|subagentStart)$/.test(event)
      ? { permission: "allow" } : event === "beforeSubmitPrompt" ? { continue: true } : {};
    assert.deepEqual(JSON.parse(output), expected, event);
  }
  const deadline = Date.now() + 3000;
  while (received.length < 19 && Date.now() < deadline) await delay(10);
  assert.equal(received.length, 19);
  assert.equal(health, 1);
  for (const form of received) assert.equal(JSON.parse(form.get("hook_input")).hook_event_name, form.get("event"));
  assert.throws(() => readFileSync(path.join(home, "node-starts")), { code: "ENOENT" });
});
