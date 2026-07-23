(function (root) {
  "use strict";

  function releaseFromPath(pathname) {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/tag\/(.+)$/);
    if (!match) return null;

    try {
      return {
        owner: decodeURIComponent(match[1]),
        repo: decodeURIComponent(match[2]),
        tag: decodeURIComponent(match[3])
      };
    } catch {
      return null;
    }
  }

  function compareUrl({ owner, repo, tag, branch }) {
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(tag)}...${encodeURIComponent(branch)}`;
  }

  function commitLabel(aheadBy, branch) {
    if (!Number.isInteger(aheadBy) || aheadBy < 0) return `Compare with ${branch}`;
    const commits = aheadBy === 1 ? "commit" : "commits";
    return `${aheadBy.toLocaleString()} ${commits} to ${branch} since this release`;
  }

  function defaultBranchFromRepositoryHtml(html) {
    const match = html.match(/"defaultBranch":"((?:\\.|[^"\\])*)"/);
    if (!match) return null;
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return null;
    }
  }

  function commitCountFromComparisonHtml(html) {
    const match = html.match(/(?:number_of_commits|numberOfCommits)(?:&quot;|")\s*:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  }

  const api = {
    releaseFromPath,
    compareUrl,
    commitLabel,
    defaultBranchFromRepositoryHtml,
    commitCountFromComparisonHtml
  };
  root.ReleaseCompareCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
