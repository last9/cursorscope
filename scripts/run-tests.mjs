#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "");
const testDir = join(root, "test");
const files = (await readdir(testDir))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join(testDir, name));

if (files.length === 0) {
  console.error("No test files found in", testDir);
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DEBUG_OTEL: "false",
    LOG_OTEL_EXPORT_ERRORS: "false"
  }
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
