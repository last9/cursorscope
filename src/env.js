import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureOtelDiagnostics } from "./otel-export-logger.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(projectRoot, ".env");

const result = dotenv.config({ path: envPath });

if (result.error && result.error.code !== "ENOENT") {
  console.warn(`[env] failed to load ${envPath}:`, result.error.message);
}

// Run before @opentelemetry/sdk imports in telemetry.js (when DEBUG_OTEL=true).
configureOtelDiagnostics();
