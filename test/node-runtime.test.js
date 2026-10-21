import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// First release on each supported line that rejects chains through the
// compromised eMudhra intermediates (nodejs/node#66871). Every Node surface
// in the repo must agree with this table.
const PATCHED = ["22.23.4", "24.22.1", "26.12.1"];

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("node runtime pins", () => {
  it("engines.node floors each supported line at its patched release", () => {
    const expected = "^22.23.4 || ^24.22.1 || >=26.12.1";
    assert.equal(JSON.parse(read("package.json")).engines.node, expected);
    assert.equal(JSON.parse(read("package-lock.json")).packages[""].engines.node, expected);
  });

  it(".nvmrc pins a patched release", () => {
    assert.ok(PATCHED.includes(read(".nvmrc").trim()));
  });

  it("README Requirements names every patched release", () => {
    const requirements = read("README.md").split("## Requirements")[1];
    for (const version of PATCHED) assert.ok(requirements.includes(version), version);
  });
});
