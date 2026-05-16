import path from "node:path";

/** @param {unknown} text */
export function countLines(text) {
  if (text === undefined || text === null) {
    return 0;
  }
  const s = String(text);
  if (s.length === 0) {
    return 0;
  }
  return s.split(/\r?\n/).length;
}

/**
 * Sum line deltas across Cursor file-edit payloads.
 * @param {Array<{ old_string?: string, new_string?: string, old_line?: string, new_line?: string }>} edits
 */
export function summarizeEdits(edits) {
  let added = 0;
  let removed = 0;

  if (!Array.isArray(edits)) {
    return { added, removed };
  }

  for (const edit of edits) {
    if (!edit || typeof edit !== "object") {
      continue;
    }
    const oldText = edit.old_string ?? edit.old_line ?? "";
    const newText = edit.new_string ?? edit.new_line ?? "";
    removed += countLines(oldText);
    added += countLines(newText);
  }

  return { added, removed };
}

/** @param {Record<string, unknown>} hookData */
export function extractFileLineStats(hookData) {
  if (!hookData || typeof hookData !== "object") {
    return null;
  }
  if (!Array.isArray(hookData.edits) || hookData.edits.length === 0) {
    return null;
  }
  return summarizeEdits(hookData.edits);
}

/** @param {unknown} filePath */
export function inferFileExtension(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    return "unknown";
  }
  const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return ext || "none";
}

/** @param {unknown} filePath */
export function basenameOnly(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    return undefined;
  }
  return path.basename(filePath);
}
