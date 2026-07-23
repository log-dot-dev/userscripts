// ==UserScript==
// @name         Github Utilities
// @namespace    https://github.com/loganschultz
// @version      1.7.0
// @description  Show commits since the latest release and prepare quick releases on GitHub repository pages.
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

  function installStyles() {
    if (document.getElementById(`${BANNER_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${BANNER_ID}-styles`;
    style.textContent = `
      #${BANNER_ID} {
        align-items: center;
        display: flex;
        font-size: 12px;
        gap: 9px;
        line-height: 18px;
        margin: 6px 0 0 48px;
      }
      #${BANNER_ID} .github-utilities__separator { color: var(--fgColor-muted, #59636e); }
      #${BANNER_ID} .github-utilities__draft.Button { min-height: 26px; }
    `;
    document.head.append(style);
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

  function nextMinorTag(tag) {
    const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return `v${match[1]}.${Number(match[2]) + 1}.${match[3]}`;
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

  function insertLink(releaseLink, repository, release, branch, count) {
    document.getElementById(BANNER_ID)?.remove();
    installStyles();
    const container = document.createElement("div");
    container.id = BANNER_ID;
    container.setAttribute("aria-label", "Release utilities");

    const comparisonUrl = compareUrl({ ...release, branch });
    const compare = document.createElement("a");
    compare.className = "Link--secondary Link";
    compare.href = comparisonUrl;
    compare.title = `Compare ${release.tag} with ${branch}`;
    compare.textContent = count === null
      ? "Compare changes"
      : `${count.toLocaleString()} ${count === 1 ? "commit" : "commits"} to ${branch}`;
    container.append(compare);

    const nextTag = nextMinorTag(release.tag);
    if (!nextTag) {
      releaseLink.insertAdjacentElement("afterend", container);
      return;
    }

    const params = new URLSearchParams({
      tag: nextTag,
      target: branch,
      title: nextTag,
      previous_tag: release.tag
    });
    const separator = document.createElement("span");
    separator.className = "github-utilities__separator";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "·";
    container.append(separator);

    const draft = document.createElement("a");
    draft.className = "github-utilities__draft Button Button--secondary Button--small";
    const releaseFormPath = `/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/releases/new`;
    draft.href = `${releaseFormPath}?${params}`;
    draft.title = `Open a pre-filled release draft for ${nextTag}`;
    draft.innerHTML = `<span class="Button-content"><span class="Button-label">Draft ${nextTag}</span></span>`;
    draft.addEventListener("click", async (event) => {
      event.preventDefault();
      draft.setAttribute("aria-disabled", "true");
      draft.querySelector(".Button-label").textContent = "Preparing notes…";
      try {
        const range = `${encodeURIComponent(release.tag)}...${encodeURIComponent(branch)}`;
        const html = await githubHtml(`/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/compare/commit-list?range=${range}`);
        const notes = releaseNotes(releaseChanges(html, repository), {
          ...repository,
          previousTag: release.tag,
          nextTag
        });
        params.set("body", notes);
      } catch {
        // GitHub still opens its standard pre-filled release form if notes cannot load.
      }
      location.assign(`${releaseFormPath}?${params}`);
    });
    container.append(draft);
    releaseLink.insertAdjacentElement("afterend", container);
  }

  function releaseChanges(html, repository) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const seenPullRequests = new Set();
    return [...parsed.querySelectorAll(".js-commits-list-item")].flatMap((item) => {
      const title = item.querySelector(".markdown-title")?.textContent.trim();
      const author = item.querySelector(".commit-author")?.textContent.trim();
      const pullRequest = [...item.querySelectorAll('a[href*="/pull/"]')].find((link) => {
        const match = new URL(link.href).pathname.match(new RegExp(`^/${repository.owner}/${repository.repo}/pull/(\\d+)$`, "i"));
        return match && !seenPullRequests.has(match[1]);
      });
      if (!title || !author || !pullRequest) return [];
      const number = new URL(pullRequest.href).pathname.match(/\/pull\/(\d+)$/)[1];
      seenPullRequests.add(number);
      return [{ title, author, number }];
    });
  }

  function releaseNotes(changes, context) {
    const bullets = changes.length
      ? changes.map(({ title, author, number }) => `* ${title} by @${author} in https://github.com/${context.owner}/${context.repo}/pull/${number}`).join("\n")
      : "* No linked pull requests found in this comparison.";
    const changelog = `https://github.com/${context.owner}/${context.repo}/compare/${encodeURIComponent(context.previousTag)}...${encodeURIComponent(context.nextTag)}`;
    return `## What's Changed\n${bullets}\n\n**Full Changelog**: ${changelog}`;
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

      if (isCurrentRepository(repository)) {
        insertLink(latest.link, repository, latest.release, branch, count);
      }
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
