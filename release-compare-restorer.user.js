// ==UserScript==
// @name         GitHub Release Compare Restorer
// @namespace    https://github.com/loganschultz
// @version      1.1.0
// @description  Show commits to the default branch since the latest release on GitHub repository pages.
// @match        https://github.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/log-dot-dev/userscripts/main/release-compare-restorer.user.js
// @updateURL    https://raw.githubusercontent.com/log-dot-dev/userscripts/main/release-compare-restorer.user.js
// ==/UserScript==

(() => {
  "use strict";

  const BANNER_ID = "release-compare-restorer";

  function repositoryFromPath(pathname) {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!match) return null;
    try {
      return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]) };
    } catch {
      return null;
    }
  }

  function releaseFromPath(pathname) {
    const match = pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/tag\/(.+)$/);
    if (!match) return null;
    try {
      return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]), tag: decodeURIComponent(match[3]) };
    } catch {
      return null;
    }
  }

  function compareUrl({ owner, repo, tag, branch }) {
    return `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(tag)}...${encodeURIComponent(branch)}`;
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

  function commitLabel(count, branch) {
    if (!Number.isInteger(count) || count < 0) return `Compare with ${branch}`;
    return `${count.toLocaleString()} ${count === 1 ? "commit" : "commits"} to ${branch} since this release`;
  }

  async function githubHtml(path) {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok || response.url.includes("/login")) throw new Error(`GitHub request failed: ${response.status}`);
    return response.text();
  }

  async function defaultBranch(release) {
    const fromPage = document.querySelector('meta[name="octolytics-dimension-repository_default_branch"]')?.content;
    if (fromPage) return fromPage;
    return defaultBranchFromRepositoryHtml(
      await githubHtml(`/${encodeURIComponent(release.owner)}/${encodeURIComponent(release.repo)}`)
    );
  }

  function isCurrentRepository(repository) {
    const current = repositoryFromPath(location.pathname);
    return current?.owner === repository.owner && current.repo === repository.repo;
  }

  function latestRelease(repository) {
    const releaseLink = [...document.querySelectorAll('a[href*="/releases/tag/"]')].find((link) => {
      const release = releaseFromPath(new URL(link.href).pathname);
      return release?.owner === repository.owner && release.repo === repository.repo;
    });
    return releaseLink ? { link: releaseLink, release: releaseFromPath(new URL(releaseLink.href).pathname) } : null;
  }

  function insertLink(releaseLink, release, branch, count) {
    document.getElementById(BANNER_ID)?.remove();
    const container = document.createElement("div");
    container.id = BANNER_ID;
    container.className = "ml-4 pl-2 mt-1 text-small color-fg-muted";

    const comparisonUrl = compareUrl({ ...release, branch });
    const link = document.createElement("a");
    link.className = "Link--secondary Link";
    link.href = comparisonUrl;
    link.textContent = count === null
      ? `Compare ${release.tag} with ${branch}`
      : `${count.toLocaleString()} ${count === 1 ? "commit" : "commits"} to ${branch} since ${release.tag}`;
    container.append(link);
    releaseLink.insertAdjacentElement("afterend", container);
  }

  async function restore() {
    document.getElementById(BANNER_ID)?.remove();
    const repository = repositoryFromPath(location.pathname);
    if (!repository) return;
    const latest = latestRelease(repository);
    if (!latest) return;

    try {
      const branch = await defaultBranch(repository);
      if (!branch || !isCurrentRepository(repository)) return;

      let count = null;
      try {
        count = commitCountFromComparisonHtml(
          await githubHtml(compareUrl({ ...latest.release, branch }))
        );
      } catch {
        // The comparison link remains useful even when GitHub cannot load a count.
      }

      if (isCurrentRepository(repository)) insertLink(latest.link, latest.release, branch, count);
    } catch {
      // Leave GitHub untouched if its page structure changes.
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
