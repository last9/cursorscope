import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskEmail, redactForLogs, redactSensitiveText } from "../src/privacy.js";

describe("privacy", () => {
  describe("maskEmail", () => {
    it("masks email addresses", () => {
      assert.equal(maskEmail("Contact user@example.com please"), "Contact ***@*** please");
    });

    it("leaves non-email strings unchanged", () => {
      assert.equal(maskEmail("no email here"), "no email here");
    });
  });

  describe("redactSensitiveText", () => {
    it("redacts emails, bearer tokens, and api keys", () => {
      const input = "user@x.com Bearer sk-abcdefghijklmnopqrstuvwxyz key-secret1234567890";
      const output = redactSensitiveText(input);
      assert.match(output, /\*\*\*@\*\*\*/);
      assert.match(output, /Bearer \*\*\*/);
      assert.match(output, /\*\*\*/);
      assert.doesNotMatch(output, /sk-abc/);
    });
  });

  describe("redactForLogs", () => {
    it("redacts sensitive keys in objects", () => {
      const out = redactForLogs({ api_key: "secret", safe: "ok" });
      assert.equal(out.api_key, "***");
      assert.equal(out.safe, "ok");
    });

    it("hides string bodies unless includeToolDetails is true", () => {
      assert.equal(redactForLogs("hello"), "[redacted string len=5]");
      assert.equal(redactForLogs("user@x.com", { includeToolDetails: true }), "***@***");
    });

    it("recurses into nested tool fields", () => {
      const out = redactForLogs(
        { tool_input: { token: "abc", command: "ls" } },
        { includeToolDetails: true }
      );
      assert.equal(out.tool_input.token, "***");
      assert.equal(out.tool_input.command, "ls");
    });
  });
});
