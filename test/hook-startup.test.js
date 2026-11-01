import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function fixture(t, version) {
  const home = await mkdtemp(path.join(tmpdir(), "cursorscope-startup-"));
  await mkdir(path.join(home, "bin"));
  await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, "bin/node"), '#!/bin/sh\necho node >> "$HOME/node-starts"\nexit 99\n', { mode: 0o755 });
  await writeFile(path.join(home, "package.json"), JSON.stringify({ name: "fixture", version: "1.2.3" }, null, 2));
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, version }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  });
  const env = { ...process.env, HOME: home, CURSORSCOPE_HOME: home,
    PATH: `${home}/bin:${process.env.PATH}`, PORT: String(server.address().port), CURSORSCOPE_AUTO_START: "true" };
  return { home, env, requests: () => requests };
}
function ensure(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["scripts/ensure-cursorscope.sh"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("healthy startup checks the version with one request and no Node process", async (t) => {
  const { home, env, requests } = await fixture(t, "1.2.3");
  const result = await ensure(env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests(), 1);
  await assert.rejects(readFile(path.join(home, "node-starts")), { code: "ENOENT" });
});

test("startup still rejects a mismatched daemon version", async (t) => {
  const { home, env, requests } = await fixture(t, "0.0.1");
  const result = await ensure(env);
  // A replacement cannot start from the deliberately incomplete fixture installation.
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing src\/server.js/);
  assert.equal(requests(), 1);
  assert.match(await readFile(path.join(home, ".cursor/cursorscope.log"), "utf8"), /running v0.0.1, expected v1.2.3/);
});
