(function () {
  "use strict";

  const {
    releaseFromPath,
    compareUrl,
    commitLabel,
    defaultBranchFromRepositoryHtml,
    commitCountFromComparisonHtml
  } = globalThis.ReleaseCompareCore;
  const BANNER_ID = "release-compare-restorer";

  function githubApi(path) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "github-api", path }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        if (response?.error || !response?.data) {
          reject(new Error(response?.error || "GitHub API request returned no data"));
          return;
        }
        resolve(response.data);
      });
    });
  }

  async function githubHtml(path) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok || response.url.includes("/login")) {
      throw new Error(`Authenticated GitHub page request failed: ${response.status}`);
    }
    return response.text();
  }

  function defaultBranchFromPage() {
    return document.querySelector('meta[name="octolytics-dimension-repository_default_branch"]')?.content || null;
  }

  async function defaultBranch(release) {
    const fromPage = defaultBranchFromPage();
    if (fromPage) return fromPage;

    try {
      const repositoryHtml = await githubHtml(`/${encodeURIComponent(release.owner)}/${encodeURIComponent(release.repo)}`);
      const branch = defaultBranchFromRepositoryHtml(repositoryHtml);
      if (branch) return branch;
    } catch {
      // Public API fallback below.
    }

    const repo = await githubApi(`/repos/${encodeURIComponent(release.owner)}/${encodeURIComponent(release.repo)}`);
    return repo.default_branch || null;
  }

  async function commitsSinceRelease(release, branch) {
    const path = `/${encodeURIComponent(release.owner)}/${encodeURIComponent(release.repo)}/compare/${encodeURIComponent(release.tag)}...${encodeURIComponent(branch)}`;
    try {
      const count = commitCountFromComparisonHtml(await githubHtml(path));
      if (Number.isInteger(count)) return count;
    } catch {
      // Public API fallback below.
    }

    const comparison = await githubApi(
      `/repos/${encodeURIComponent(release.owner)}/${encodeURIComponent(release.repo)}/compare/${encodeURIComponent(release.tag)}...${encodeURIComponent(branch)}`
    );
    return comparison.ahead_by;
  }

  function insertLink(release, branch, aheadBy) {
    document.getElementById(BANNER_ID)?.remove();
    const anchor = document.querySelector('[data-testid="release-header"], .release-header, main h1');
    if (!anchor) return;

    const container = document.createElement("div");
    container.id = BANNER_ID;
    container.className = "mt-2 mb-3 color-fg-muted";

    const link = document.createElement("a");
    link.className = "Link--secondary Link";
    link.href = compareUrl({ ...release, branch });
    link.textContent = commitLabel(aheadBy, branch);
    container.append(link);
    anchor.insertAdjacentElement("afterend", container);
  }

  function isCurrentRelease(release) {
    const current = releaseFromPath(location.pathname);
    return current?.owner === release.owner && current.repo === release.repo && current.tag === release.tag;
  }

  async function restore() {
    document.getElementById(BANNER_ID)?.remove();
    const release = releaseFromPath(location.pathname);
    if (!release) return;

    try {
      const branch = await defaultBranch(release);
      if (!branch || !isCurrentRelease(release)) return;
      let aheadBy = null;
      try {
        aheadBy = await commitsSinceRelease(release, branch);
      } catch {
        // A comparison link is still useful when GitHub's API is rate-limited.
      }
      if (isCurrentRelease(release)) {
        insertLink(release, branch, aheadBy);
      }
    } catch {
      // Leave GitHub untouched if its markup or API changes.
    }
  }

  let scheduled = false;
  function scheduleRestore() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      restore();
    }, 0);
  }

  document.addEventListener("turbo:load", scheduleRestore);
  document.addEventListener("pjax:end", scheduleRestore);
  window.addEventListener("popstate", scheduleRestore);
  scheduleRestore();
})();
