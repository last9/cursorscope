import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("benchmark reports every registered command and enforces a p95 budget", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "cursorscope-bench-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hooks = path.join(dir, "hooks.json");
  writeFileSync(hooks, JSON.stringify({ hooks: {
    preToolUse: [{ command: "printf '{}'" }],
    sessionStart: [{ command: "printf '{}'" }, { command: "printf '{}'" }]
  } }));
  const run = (budget) => spawnSync(process.execPath, [
    "scripts/benchmark-hooks.js", "--hooks", hooks, "--runs", "3", "--budget-ms", budget
  ], { encoding: "utf8" });
  const result = run("1000");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.results.length, 3);
  for (const row of report.results) {
    assert.equal(row.runs, 3);
    assert.ok(row.p50_ms > 0);
    assert.ok(row.p95_ms >= row.p50_ms);
  }
  assert.equal(run("0.00001").status, 1);
});
