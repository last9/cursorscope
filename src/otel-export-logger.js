import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";

const exportLoggingEnabled = process.env.LOG_OTEL_EXPORT_ERRORS !== "false";
let diagnosticsConfigured = false;

export function configureOtelDiagnostics() {
  if (diagnosticsConfigured) {
    return;
  }
  diagnosticsConfigured = true;

  // SDK packages may register a diag logger during import; only override for DEBUG_OTEL.
  if (process.env.DEBUG_OTEL !== "true") {
    return;
  }

  const level = (process.env.OTEL_DIAG_LOG_LEVEL || "ERROR").toUpperCase();
  const levelMap = {
    NONE: DiagLogLevel.NONE,
    ERROR: DiagLogLevel.ERROR,
    WARN: DiagLogLevel.WARN,
    INFO: DiagLogLevel.INFO,
    DEBUG: DiagLogLevel.DEBUG,
    VERBOSE: DiagLogLevel.VERBOSE,
    ALL: DiagLogLevel.ALL
  };

  const diagLevel = levelMap[level] ?? DiagLogLevel.DEBUG;

  diag.setLogger(new DiagConsoleLogger(), {
    logLevel: diagLevel,
    suppressOverrideMessage: true
  });
}

export function wrapExporterWithLogging(exporter, signal, destination) {
  if (!exportLoggingEnabled || !exporter?.export) {
    return exporter;
  }

  const originalExport = exporter.export.bind(exporter);

  exporter.export = (items, resultCallback) => {
    const onResult = (result) => {
      logExportResult(signal, destination, result, items);
      if (typeof resultCallback === "function") {
        resultCallback(result);
      }
    };

    try {
      const maybePromise = originalExport(items, onResult);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.catch((error) => {
          logExportException(signal, destination, error, items);
        });
      }
    } catch (error) {
      logExportException(signal, destination, error, items);
      throw error;
    }
  };

  return exporter;
}

function logExportResult(signal, destination, result, items) {
  if (!result || result.code === ExportResultCode.SUCCESS) {
    return;
  }

  console.error("[otel-export] export failed", {
    signal,
    destination,
    resultCode: result.code,
    error: result.error?.message,
    cause: result.error?.cause?.message,
    itemCount: countItems(items)
  });
}

function logExportException(signal, destination, error, items) {
  console.error("[otel-export] export threw", {
    signal,
    destination,
    error: error?.message,
    cause: error?.cause?.message,
    itemCount: countItems(items)
  });
}

function countItems(items) {
  if (Array.isArray(items)) {
    return items.length;
  }
  if (items && typeof items === "object") {
    return 1;
  }
  return 0;
}
