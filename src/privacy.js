const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9]{10,}|key-[A-Za-z0-9]{10,})\b/g;

export function maskEmail(value) {
  if (typeof value !== "string" || !value.includes("@")) {
    return value;
  }
  return value.replace(EMAIL_PATTERN, "***@***");
}

export function redactSensitiveText(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(EMAIL_PATTERN, "***@***").replace(BEARER_PATTERN, "Bearer ***").replace(API_KEY_PATTERN, "***");
}

export function redactForLogs(value, { includeToolDetails = false } = {}) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return includeToolDetails ? redactSensitiveText(value) : `[redacted string len=${value.length}]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLogs(item, { includeToolDetails }));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        out[key] = "***";
        continue;
      }
      if (key === "prompt" || key === "text" || key === "tool_output" || key === "tool_input") {
        out[key] = redactForLogs(nested, { includeToolDetails });
        continue;
      }
      if (typeof nested === "string") {
        out[key] = redactSensitiveText(nested);
        continue;
      }
      out[key] = redactForLogs(nested, { includeToolDetails });
    }
    return out;
  }
  return value;
}

function isSensitiveKey(key) {
  return /api[_-]?key|token|password|secret|authorization/i.test(key);
}
