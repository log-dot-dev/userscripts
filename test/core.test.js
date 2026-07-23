const test = require("node:test");
const assert = require("node:assert/strict");
const {
  releaseFromPath,
  repositoryFromPath,
  compareUrl,
  commitLabel,
  nextMinorTag,
  defaultBranchFromRepositoryHtml,
  commitCountFromComparisonHtml
} = require("../core.js");

test("parses a release tag route, including encoded slash tags", () => {
  assert.deepEqual(releaseFromPath("/acme/widgets/releases/tag/v1.2.3"), {
    owner: "acme", repo: "widgets", tag: "v1.2.3"
  });
  assert.equal(releaseFromPath("/acme/widgets/releases"), null);
  assert.equal(releaseFromPath("/acme/widgets/releases/tag/release%2F2026-07" ).tag, "release/2026-07");
});

test("parses only a repository overview route", () => {
  assert.deepEqual(repositoryFromPath("/acme/widgets"), { owner: "acme", repo: "widgets" });
  assert.equal(repositoryFromPath("/acme/widgets/releases"), null);
});

test("builds an encoded GitHub comparison URL", () => {
  assert.equal(
    compareUrl({ owner: "acme", repo: "widgets", tag: "release/2026", branch: "main" }),
    "https://github.com/acme/widgets/compare/release%2F2026...main"
  );
});

test("formats the restored label", () => {
  assert.equal(commitLabel(1, "main"), "1 commit to main since this release");
  assert.equal(commitLabel(42, "main"), "42 commits to main since this release");
  assert.equal(commitLabel(null, "main"), "Compare with main");
});

test("bumps the middle component of a v-prefixed release tag", () => {
  assert.equal(nextMinorTag("v1.1.1"), "v1.2.1");
  assert.equal(nextMinorTag("v3.19.0"), "v3.20.0");
  assert.equal(nextMinorTag("release-1.1.1"), null);
});

test("extracts private-session data from GitHub HTML", () => {
  assert.equal(
    defaultBranchFromRepositoryHtml('<script>{"defaultBranch":"release\\/2026"}</script>'),
    "release/2026"
  );
  assert.equal(defaultBranchFromRepositoryHtml("<html></html>"), null);
  assert.equal(
    commitCountFromComparisonHtml('data="number_of_commits&quot;:3940"'),
    3940
  );
  assert.equal(commitCountFromComparisonHtml("<html></html>"), null);
});
