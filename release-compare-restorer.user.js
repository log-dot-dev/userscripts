// ==UserScript==
// @name         GitHub Release Compare Restorer
// @namespace    https://github.com/loganschultz
// @version      1.0.1
// @description  Restore “N commits to main since this release” on GitHub release pages.
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
        gap: 8px;
        margin: 9px 0 17px;
      }
      #${BANNER_ID} .release-compare-restorer__icon {
        color: var(--fgColor-muted, #59636e);
        flex: 0 0 auto;
      }
      #${BANNER_ID} .release-compare-restorer__content { min-width: 0; }
      #${BANNER_ID} .release-compare-restorer__headline {
        color: var(--fgColor-accent, #0969da);
        font-size: 12px;
        font-weight: 600;
        line-height: 1.4;
        text-decoration: none;
      }
      #${BANNER_ID} .release-compare-restorer__headline:hover { text-decoration: underline; }
      #${BANNER_ID} .release-compare-restorer__route {
        color: var(--fgColor-muted, #59636e);
        font-size: 12px;
        margin-left: 2px;
      }
      #${BANNER_ID} .release-compare-restorer__route code {
        color: inherit;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
    `;
    document.head.append(style);
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

  function isCurrentRelease(release) {
    const current = releaseFromPath(location.pathname);
    return current?.owner === release.owner && current.repo === release.repo && current.tag === release.tag;
  }

  function insertLink(release, branch, count) {
    document.getElementById(BANNER_ID)?.remove();
    const anchor = document.querySelector('[data-testid="release-header"], .release-header, main h1');
    if (!anchor) return;

    installStyles();
    const container = document.createElement("div");
    container.id = BANNER_ID;
    container.setAttribute("aria-label", "Release comparison");

    const icon = document.createElement("span");
    icon.className = "release-compare-restorer__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.5 2.75A.75.75 0 0 1 2.25 2h5.5a.75.75 0 0 1 .53.22l1.5 1.5a.75.75 0 0 0 .53.22h3.44a.75.75 0 0 1 .75.75v8.56a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75V2.75Zm1.5.75v9h10v-7H10a1.5 1.5 0 0 1-1.06-.44L7.44 3.5H3Z"></path></svg>';
    container.append(icon);

    const content = document.createElement("div");
    content.className = "release-compare-restorer__content";

    const comparisonUrl = compareUrl({ ...release, branch });
    const headline = document.createElement("a");
    headline.className = "release-compare-restorer__headline";
    headline.href = comparisonUrl;
    headline.textContent = count === null ? `Compare this release with ${branch}` : commitLabel(count, branch);
    content.append(headline);

    const route = document.createElement("span");
    route.className = "release-compare-restorer__route";
    route.innerHTML = `(<code>${escapeHtml(release.tag)}</code> <span aria-hidden="true">→</span> <code>${escapeHtml(branch)}</code>)`;
    content.append(route);
    container.append(content);
    anchor.insertAdjacentElement("afterend", container);
  }

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
  }

  async function restore() {
    document.getElementById(BANNER_ID)?.remove();
    const release = releaseFromPath(location.pathname);
    if (!release) return;

    try {
      const branch = await defaultBranch(release);
      if (!branch || !isCurrentRelease(release)) return;

      let count = null;
      try {
        count = commitCountFromComparisonHtml(
          await githubHtml(compareUrl({ ...release, branch }))
        );
      } catch {
        // The comparison link remains useful even when GitHub cannot load a count.
      }

      if (isCurrentRelease(release)) insertLink(release, branch, count);
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
