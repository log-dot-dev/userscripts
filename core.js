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

  function repositoryFromPath(pathname) {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!match) return null;
    try {
      return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]) };
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

  function nextTag(tag) {
    const semver = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (semver) return `v${semver[1]}.${Number(semver[2]) + 1}.${semver[3]}`;
    const trailing = tag.match(/^(.*?)(\d+)(\D*)$/);
    if (!trailing) return null;
    return `${trailing[1]}${Number(trailing[2]) + 1}${trailing[3]}`;
  }

  function defaultBranchFromRepositoryHtml(html) {
    const patterns = [
      /"defaultBranch":"((?:\\.|[^"\\])*)"/,
      /"refInfo":\{"name":"((?:\\.|[^"\\])*)"/,
      /\/tree\/([^"\\/?#]+)/
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        const value = JSON.parse(`"${match[1]}"`);
        if (value && value !== "HEAD") return value;
      } catch {
        if (match[1] && match[1] !== "HEAD") return match[1];
      }
    }
    return null;
  }

  function commitCountFromComparisonHtml(html) {
    const match = html.match(/(?:number_of_commits|numberOfCommits)(?:&quot;|")\s*:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  }

  const api = {
    releaseFromPath,
    repositoryFromPath,
    compareUrl,
    commitLabel,
    nextTag,
    defaultBranchFromRepositoryHtml,
    commitCountFromComparisonHtml
  };
  root.ReleaseCompareCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
