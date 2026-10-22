import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const changelog = read("CHANGELOG.md");
const releases = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)].map((m) => m[1]);
const links = Object.fromEntries(
  [...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1], m[2]])
);

describe("release metadata", () => {
  it("package.json and package-lock.json carry the newest CHANGELOG release", () => {
    const version = JSON.parse(read("package.json")).version;
    const lock = JSON.parse(read("package-lock.json"));
    assert.equal(releases[0], version);
    assert.equal(lock.version, version);
    assert.equal(lock.packages[""].version, version);
  });

  it("[Unreleased] compares from the newest release tag", () => {
    assert.equal(links.Unreleased, `https://github.com/last9/cursorscope/compare/v${releases[0]}...HEAD`);
  });

  it("every release heading has a compare link from the release before it", () => {
    releases.slice(0, -1).forEach((version, i) => {
      assert.equal(
        links[version],
        `https://github.com/last9/cursorscope/compare/v${releases[i + 1]}...v${version}`,
        version
      );
    });
  });
});
