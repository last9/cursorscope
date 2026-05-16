import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  basenameOnly,
  countLines,
  extractFileLineStats,
  inferFileExtension,
  summarizeEdits
} from "../src/line-stats.js";

describe("line-stats", () => {
  describe("countLines", () => {
    it("returns 0 for empty or nullish input", () => {
      assert.equal(countLines(null), 0);
      assert.equal(countLines(undefined), 0);
      assert.equal(countLines(""), 0);
    });

    it("counts single and multiline strings", () => {
      assert.equal(countLines("hello"), 1);
      assert.equal(countLines("a\nb"), 2);
      assert.equal(countLines("a\r\nb\nc"), 3);
    });
  });

  describe("summarizeEdits", () => {
    it("sums line deltas across edits", () => {
      const result = summarizeEdits([
        { old_string: "a\nb", new_string: "a\nc\nd" }
      ]);
      assert.deepEqual(result, { added: 3, removed: 2 });
    });

    it("supports tab-style old_line and new_line", () => {
      const result = summarizeEdits([{ old_line: "x", new_line: "y\nz" }]);
      assert.deepEqual(result, { added: 2, removed: 1 });
    });

    it("returns zeros for invalid edits input", () => {
      assert.deepEqual(summarizeEdits(null), { added: 0, removed: 0 });
      assert.deepEqual(summarizeEdits([]), { added: 0, removed: 0 });
    });
  });

  describe("extractFileLineStats", () => {
    it("returns null when edits are missing", () => {
      assert.equal(extractFileLineStats({}), null);
      assert.equal(extractFileLineStats({ edits: [] }), null);
    });

    it("extracts stats from hook payload", () => {
      const stats = extractFileLineStats({
        edits: [{ old_string: "line1", new_string: "line1\nline2" }]
      });
      assert.deepEqual(stats, { added: 2, removed: 1 });
    });
  });

  describe("inferFileExtension", () => {
    it("parses extension from path", () => {
      assert.equal(inferFileExtension("/tmp/foo.ts"), "ts");
      assert.equal(inferFileExtension("/tmp/README"), "none");
      assert.equal(inferFileExtension(""), "unknown");
    });
  });

  describe("basenameOnly", () => {
    it("returns basename for valid paths", () => {
      assert.equal(basenameOnly("/a/b/c.ts"), "c.ts");
      assert.equal(basenameOnly(undefined), undefined);
    });
  });
});
