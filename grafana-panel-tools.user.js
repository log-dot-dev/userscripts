// ==UserScript==
// @name         Grafana Panel Tools
// @namespace    https://github.com/loganschultz
// @version      1.0.2
// @description  Copy a time-locked panel link or rendered panel image from Grafana dashboard panels.
// @match        *://*/d/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/log-dot-dev/userscripts/main/grafana-panel-tools.user.js
// @updateURL    https://raw.githubusercontent.com/log-dot-dev/userscripts/main/grafana-panel-tools.user.js
// ==/UserScript==

(() => {
  "use strict";

  const TOOLBAR_CLASS = "grafana-panel-tools";
  const PANEL_HOST_CLASS = `${TOOLBAR_CLASS}__host`;
  const PANEL_SELECTOR = [
    "[data-panelid]",
    "[data-viz-panel-key]",
    '[data-testid="panel-container"]',
    '[data-testid^="panel-container-"]'
  ].join(", ");

  function installStyles() {
    if (document.getElementById(`${TOOLBAR_CLASS}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${TOOLBAR_CLASS}-styles`;
    style.textContent = `
      .${TOOLBAR_CLASS} {
        display: none;
        gap: 3px;
        position: absolute;
        right: 44px;
        top: 8px;
        z-index: 10;
      }
      .${PANEL_HOST_CLASS}:hover > .${TOOLBAR_CLASS}, .${PANEL_HOST_CLASS}:focus-within > .${TOOLBAR_CLASS} { display: flex; }
      .${TOOLBAR_CLASS}__button {
        align-items: center;
        background: var(--background-secondary, var(--bgColor-neutral-muted, #2a2f38));
        border: 0;
        border-radius: 6px;
        color: var(--text-secondary, var(--fgColor-muted, #aeb6c2));
        cursor: pointer;
        display: inline-flex;
        height: 32px;
        justify-content: center;
        padding: 0;
        width: 32px;
      }
      .${TOOLBAR_CLASS}__button:hover { color: var(--text-primary, var(--fgColor-default, #f0f3f6)); background: var(--background-secondary-hover, #353b45); }
      .${TOOLBAR_CLASS}__button[aria-busy="true"] { cursor: progress; opacity: .8; }
      .${TOOLBAR_CLASS}__button[aria-busy="true"] svg { display: none; }
      .${TOOLBAR_CLASS}__button[aria-busy="true"]::after {
        animation: ${TOOLBAR_CLASS}-spin .7s linear infinite;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        content: "";
        height: 12px;
        width: 12px;
      }
      .${TOOLBAR_CLASS}__button.is-success { color: var(--color-green, #3fb950); }
      .${TOOLBAR_CLASS}__button.is-success svg { animation: ${TOOLBAR_CLASS}-check .22s ease-out; }
      @keyframes ${TOOLBAR_CLASS}-spin { to { transform: rotate(360deg); } }
      @keyframes ${TOOLBAR_CLASS}-check { from { opacity: 0; transform: scale(.55); } to { opacity: 1; transform: scale(1); } }
    `;
    document.head.append(style);
  }

  function panelId(panel) {
    const direct = panel.getAttribute("data-panelid") || panel.querySelector("[data-panelid]")?.getAttribute("data-panelid");
    if (direct && direct !== "undefined") return direct;

    const sceneKey = panel.getAttribute("data-viz-panel-key") || panel.querySelector("[data-viz-panel-key]")?.getAttribute("data-viz-panel-key");
    const match = sceneKey?.match(/(?:^|[-_:])(\d+)$/);
    return match?.[1] || null;
  }

  function absoluteTime(value, now) {
    if (!value || value === "now") return String(now);
    const match = value.match(/^now-(\d+)(ms|s|m|h|d|w)$/);
    if (!match) return value;
    const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    return String(now - Number(match[1]) * units[match[2]]);
  }

  function panelUrl(id) {
    const url = new URL(location.href);
    const now = Date.now();
    url.searchParams.set("viewPanel", id);
    url.searchParams.set("from", absoluteTime(url.searchParams.get("from"), now));
    url.searchParams.set("to", absoluteTime(url.searchParams.get("to"), now));
    return url;
  }

  function imageUrl(id) {
    const url = panelUrl(id);
    url.pathname = url.pathname.replace(/^\/d\//, "/render/d-solo/");
    url.searchParams.delete("viewPanel");
    url.searchParams.set("panelId", id);
    url.searchParams.set("width", "1000");
    url.searchParams.set("height", "500");
    url.searchParams.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    return url;
  }

  function setStatus(button, label) {
    const original = button.dataset.label;
    button.setAttribute("aria-label", label);
    button.title = label;
    setTimeout(() => {
      button.setAttribute("aria-label", original);
      button.title = original;
    }, 1800);
  }

  function setLoading(button, loading) {
    button.toggleAttribute("aria-busy", loading);
    button.disabled = loading;
  }

  function showSuccess(button, label) {
    setLoading(button, false);
    button.classList.add("is-success");
    button.innerHTML = icon("M13.78 3.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0L2.97 7.53a.75.75 0 1 1 1.06-1.06l2.72 2.72 5.97-5.97a.75.75 0 0 1 1.06 0Z");
    setStatus(button, label);
    clearTimeout(Number(button.dataset.successTimer));
    button.dataset.successTimer = String(setTimeout(() => {
      button.classList.remove("is-success");
      button.innerHTML = button.dataset.icon;
    }, 1800));
  }

  function icon(path) {
    return `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="${path}"></path></svg>`;
  }

  function actionButton(label, svgPath, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${TOOLBAR_CLASS}__button`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = icon(svgPath);
    button.dataset.label = label;
    button.dataset.icon = button.innerHTML;
    button.addEventListener("click", handler);
    return button;
  }

  async function copyImage(button, id) {
    try {
      setLoading(button, true);
      const response = await fetch(imageUrl(id), { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Render request failed: ${response.status}`);
      const image = await response.blob();
      if (!image.type.startsWith("image/")) throw new Error("Render request did not return an image");
      await navigator.clipboard.write([new ClipboardItem({ [image.type]: image })]);
      showSuccess(button, "Panel image copied");
    } catch {
      setStatus(button, "Could not copy image");
    } finally {
      setLoading(button, false);
    }
  }

  function addToolbar(panel) {
    if (panel.querySelector(`:scope > .${TOOLBAR_CLASS}`)) return;
    const id = panelId(panel);
    if (!id) return;
    panel.classList.add(PANEL_HOST_CLASS);
    panel.style.position ||= "relative";

    const toolbar = document.createElement("div");
    toolbar.className = TOOLBAR_CLASS;
    toolbar.append(
      actionButton(
        "Copy time-locked panel link",
        "M0 1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v5.5a.75.75 0 0 1-1.5 0v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h5.5a.75.75 0 0 1 0 1.5h-5.5A1.75 1.75 0 0 1 0 10.25v-8.5ZM5.75 4C4.784 4 4 4.784 4 5.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 16 14.25v-8.5A1.75 1.75 0 0 0 14.25 4h-8.5Zm-.25 1.75c0-.138.112-.25.25-.25h8.5c.138 0 .25.112.25.25v8.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5Z",
        async (event) => {
          const button = event.currentTarget;
          try {
            setLoading(button, true);
            await navigator.clipboard.writeText(panelUrl(id).toString());
            showSuccess(button, "Panel link copied");
          } catch {
            setStatus(button, "Could not copy link");
          } finally {
            setLoading(button, false);
          }
        }
      ),
      actionButton(
        "Copy panel image",
        "M1.75 2A1.75 1.75 0 0 0 0 3.75v8.5C0 13.216.784 14 1.75 14h12.5c.966 0 1.75-.784 1.75-1.75v-8.5A1.75 1.75 0 0 0 14.25 2H1.75ZM1.5 3.75c0-.138.112-.25.25-.25h12.5c.138 0 .25.112.25.25v5.13l-2.68-2.68a1.75 1.75 0 0 0-2.475 0L5.5 10.07 4.15 8.72a1.75 1.75 0 0 0-2.475 0L1.5 8.895V3.75Zm0 7.266 1.235-1.235a.25.25 0 0 1 .354 0l1.88 1.88a.75.75 0 0 0 1.06 0l4.376-4.376a.25.25 0 0 1 .354 0l3.741 3.741v1.224a.25.25 0 0 1-.25.25H1.75a.25.25 0 0 1-.25-.25v-1.234ZM5.5 5.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5Z",
        (event) => copyImage(event.currentTarget, id)
      )
    );
    panel.append(toolbar);
  }

  function install() {
    if (!document.querySelector(PANEL_SELECTOR)) return;
    installStyles();
    document.querySelectorAll(PANEL_SELECTOR).forEach(addToolbar);
  }

  const observer = new MutationObserver(install);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("visibilitychange", () => !document.hidden && install());
  install();
})();
