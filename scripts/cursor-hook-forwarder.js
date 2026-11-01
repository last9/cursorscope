#!/usr/bin/env node
// Compatibility entry for custom hooks. Installed hooks invoke the shell directly.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn("bash", [
  fileURLToPath(new URL("./cursorscope-forward.sh", import.meta.url)),
  ...process.argv.slice(2)
], { stdio: "inherit", env: {
  ...process.env,
  CURSORSCOPE_HOME: process.env.CURSORSCOPE_HOME || fileURLToPath(new URL("..", import.meta.url))
} });
child.on("error", (error) => {
  console.error("Hook forward failed:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => { process.exitCode = code ?? 1; });
