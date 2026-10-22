// ==UserScript==
// @name         Inbound Packages
// @namespace    https://github.com/loganschultz
// @version      1.0.0
// @description  Clean inbound package list from UPS My Choice and FedEx Delivery Manager, straight from their JSON APIs.
// @match        *://www.ups.com/upsmychoice*
// @match        *://www.ups.com/us/en/track/ups-my-choice*
// @match        *://www.fedex.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      webapis.ups.com
// @connect      api.fedex.com
// @noframes
// @downloadURL  https://raw.githubusercontent.com/log-dot-dev/userscripts/main/inbound-packages.user.js
// @updateURL    https://raw.githubusercontent.com/log-dot-dev/userscripts/main/inbound-packages.user.js
// ==/UserScript==

(() => {
  "use strict";

  const UPS_TOKEN_URL = "https://webapis.ups.com/upsmychoice/api/Init/gettoken";
  const UPS_INBOUND_URL = "https://webapis.ups.com/upsmychoice/api/v1/ParcelInbound/GetInboundByAddressToken";
  const FEDEX_TOKEN_URL = "https://api.fedex.com/auth/oauth/v2/token";
  const FEDEX_LIST_URL = "https://api.fedex.com/track/v2/shipments/visibilitieslist";

  // Public app ids published in fedex.com's own front-end config.
  const FEDEX_CLIENT_IDS = [
    "l7d2cc0795a716415c9ff2d5c4e4f2e5fc",
    "l7xx474b79016a4d4ec5a60bf7a7e5e7e6fe"
  ];

  const HOST_ID = "inbound-packages-host";
  const DEFAULT_UPS_LABEL = "Home";

  const store = {
    get(key, fallback) {
      try {
        const value = GM_getValue(key);
        return value === undefined ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        GM_setValue(key, value);
      } catch {
        /* ignore */
      }
    }
  };

  function request(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 25000,
        ...options,
        onload: resolve,
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout"))
      });
    });
  }

  async function jsonRequest(options) {
    const res = await request(options);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    return JSON.parse(res.responseText);
  }

  // ---------- UPS address bootstrap ----------
  // The My Choice SPA learns address tokens during its own calls. Capture them
  // once so later runs can talk to the JSON API directly.

  function rememberUps(enrollment) {
    if (!enrollment || !enrollment.addressToken) return;
    const tokens = store.get("ups.enrollments", []);
    const existing = tokens.find((item) => item.addressToken === enrollment.addressToken) || {};
    const merged = { ...existing, ...enrollment };
    const next = tokens.filter((item) => item.addressToken !== enrollment.addressToken);
    next.push(merged);
    store.set("ups.enrollments", next.slice(-10));
    if (merged.userName) store.set("ups.userName", merged.userName);
  }

  function labelFromTrafficCop(body) {
    const list = body && (body.enrollments || body.multipleEnrollments);
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const token = item.addressToken ||
        (item.enrollmentInformation && item.enrollmentInformation.enrollmentInformation &&
          item.enrollmentInformation.enrollmentInformation.addressToken);
      const label = item.enrollmentDescription ||
        (item.enrollmentInformation && item.enrollmentInformation.enrollmentDescription);
      if (token && label) rememberUps({ addressToken: token, label });
    }
  }

  function installUpsHooks() {
    if (!/(^|\.)ups\.com$/.test(location.hostname)) return;

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const body = init && init.body;
      const result = originalFetch.apply(this, arguments);
      try {
        if (url && url.includes("GetInboundByAddressToken") && typeof body === "string") {
          const parsed = JSON.parse(body);
          if (parsed.addressToken) {
            rememberUps({ addressToken: parsed.addressToken, userName: parsed.UserName });
          }
        }
        if (url && url.includes("TrafficCop")) {
          result.then((res) => res.clone().json()).then(labelFromTrafficCop).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return result;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__pkgUrl = String(url || "");
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const url = this.__pkgUrl || "";
      try {
        if (url.includes("GetInboundByAddressToken") && typeof body === "string") {
          const parsed = JSON.parse(body);
          if (parsed.addressToken) {
            rememberUps({ addressToken: parsed.addressToken, userName: parsed.UserName });
          }
        }
        if (url.includes("TrafficCop")) {
          this.addEventListener("load", () => {
            try {
              labelFromTrafficCop(JSON.parse(this.responseText));
            } catch {
              /* ignore */
            }
          });
        }
      } catch {
        /* ignore */
      }
      return originalSend.apply(this, arguments);
    };
  }

  // ---------- carriers ----------

  async function fetchUps(labelFilter) {
    const enrollments = store.get("ups.enrollments", []);
    if (!enrollments.length) {
      throw new Error("no UPS address token yet — open My Choice once to bootstrap");
    }
    const userName = store.get("ups.userName", "");

    const tokenBody = JSON.stringify({ headers: { normalizedNames: {}, lazyUpdate: null } });
    const token = await jsonRequest({
      method: "POST",
      url: UPS_TOKEN_URL,
      headers: { accept: "text/plain", "content-type": "application/json" },
      data: tokenBody
    });

    const headerName = token.headerName || "X-CSRF-Token";
    const headerValue = token.requestToken || token.cookieToken;

    let selected = enrollments;
    let note = "";
    if (labelFilter) {
      const matched = enrollments.filter(
        (item) => (item.label || "").toLowerCase() === labelFilter.toLowerCase()
      );
      if (matched.length) {
        selected = matched;
      } else {
        note = `label ${labelFilter} not found; showing all addresses`;
      }
    }

    const rows = [];
    let lastError = null;
    for (const enrollment of selected) {
      try {
        const body = await jsonRequest({
          method: "POST",
          url: UPS_INBOUND_URL,
          headers: {
            accept: "text/plain",
            "content-type": "application/json-patch+json",
            [headerName]: headerValue
          },
          data: JSON.stringify({
            UserName: userName,
            addressToken: enrollment.addressToken,
            Locale: "en_US"
          })
        });
        for (const parcel of body.parcels || []) {
          if (parcel.delivered) continue;
          rows.push({
            carrier: "UPS",
            shipper: (parcel.merchantName || "").trim() || "Unknown shipper",
            status: (parcel.shipTrackingStatus && parcel.shipTrackingStatus.description) ||
              (parcel.currentStatus && parcel.currentStatus.description) || "",
            eta: isoDate(parcel.currentScheduleDelivery) ||
              isoDate(parcel.originalScheduleDelivery &&
                parcel.originalScheduleDelivery.deliverySchedule &&
                parcel.originalScheduleDelivery.deliverySchedule.dateTime) ||
              isoDate(parcel.currentEvent && parcel.currentEvent.dateTime),
            tracking: parcel.trackingNumber || "",
            signature: Boolean(parcel.adultShipmentReleaseEligible) ||
              (parcel.additionalServices || []).some((s) => String(s).toUpperCase().includes("SIGNATURE")),
            address: enrollment.label || ""
          });
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (!rows.length && lastError) throw lastError;
    if (note) rows.note = note;
    return rows;
  }

  async function fedexToken() {
    let lastError = null;
    for (const clientId of FEDEX_CLIENT_IDS) {
      try {
        const url = `${FEDEX_TOKEN_URL}?client_id=${encodeURIComponent(clientId)}&grant_type=client_credentials&scope=oob`;
        const body = await jsonRequest({
          method: "POST",
          url,
          headers: { accept: "*/*", "content-type": "application/x-www-form-urlencoded" },
          data: ""
        });
        if (body.access_token) return body.access_token;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("no FedEx token");
  }

  async function fetchFedex() {
    const token = await fedexToken();
    const body = await jsonRequest({
      method: "POST",
      url: FEDEX_LIST_URL,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-clientid": "WTRK",
        authorization: `Bearer ${token}`
      },
      data: JSON.stringify({
        appDeviceType: "WTRK",
        appType: "WTRK",
        processingParameters: {},
        uniqueKey: "",
        dvx_Customer: "true",
        pageSize: "500",
        pageToken: "",
        sort: "EDD",
        updatedSinceTs: ""
      })
    });
    const items = (body.output && body.output.shipmentLightInfo) || [];
    return items
      .filter((item) => String(item.isDel) !== "1")
      .map((item) => ({
        carrier: "FedEx",
        shipper: (item.shprNm || item.shprCoNm || "").trim() || "Unknown shipper",
        status: (item.keyStat || item.mainStat || item.subStat || "").trim(),
        eta: isoDate(item.estDelTs) || isoDate(item.dispEstDelDt),
        tracking: item.trkNbr || "",
        signature: String(item.signReq) === "1",
        address: ""
      }));
  }

  function isoDate(value) {
    if (!value) return "";
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (match) {
      const [, m, d, y] = match;
      const year = y.length === 2 ? `20${y}` : y;
      return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return "";
  }

  // ---------- UI ----------

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      color: var(--fg); font-size: 12px; line-height: 1.35;
      --bg: #0b0e10; --panel: #101619; --line: #1e2a2e; --fg: #dfe8e6;
      --muted: #7b8b90; --accent: #35d0ba; --warn: #e0a43a;
    }
    .launcher {
      appearance: none; border: 1px solid var(--line); background: var(--panel);
      color: var(--fg); padding: 7px 11px; border-radius: 999px; cursor: pointer;
      letter-spacing: .09em; font: inherit; font-size: 11px;
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
    }
    .launcher:hover { border-color: var(--accent); color: var(--accent); }
    .panel {
      width: 440px; max-height: 70vh; display: flex; flex-direction: column;
      background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
      box-shadow: 0 18px 50px rgba(0,0,0,.55); overflow: hidden;
      margin-bottom: 10px;
    }
    header {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px;
      border-bottom: 1px solid var(--line); letter-spacing: .1em; font-size: 11px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
    .count { color: var(--muted); letter-spacing: 0; }
    header .spacer { flex: 1; }
    header button {
      appearance: none; background: transparent; border: 1px solid transparent;
      color: var(--muted); font: inherit; font-size: 11px; padding: 3px 6px;
      border-radius: 5px; cursor: pointer; letter-spacing: .04em;
    }
    header button:hover { color: var(--accent); border-color: var(--line); }
    .body { overflow: auto; padding: 4px 0 8px; }
    .row {
      display: grid; grid-template-columns: 44px 1fr auto; gap: 8px;
      padding: 7px 12px; border-bottom: 1px solid rgba(30,42,46,.55);
    }
    .row:last-child { border-bottom: 0; }
    .row:hover { background: rgba(53,208,186,.045); }
    .tag { color: var(--accent); font-size: 10px; letter-spacing: .06em; padding-top: 1px; }
    .tag.fedex { color: #b48cff; }
    .main { min-width: 0; }
    .shipper { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .side { text-align: right; white-space: nowrap; }
    .eta { color: var(--accent); }
    .sig {
      display: inline-block; margin-left: 6px; padding: 0 4px; border-radius: 3px;
      border: 1px solid var(--warn); color: var(--warn); font-size: 9px; letter-spacing: .06em;
    }
    .track { color: var(--muted); cursor: pointer; }
    .track:hover { color: var(--fg); text-decoration: underline; }
    .empty, .error { padding: 12px; color: var(--muted); }
    .error { color: var(--warn); }
    .foot { padding: 7px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
  `;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function prettyDate(iso) {
    if (!iso) return "no date";
    const today = new Date();
    const date = new Date(`${iso}T12:00:00`);
    const same = (a, b) => a.toDateString() === b.toDateString();
    const tomorrow = new Date(today.getTime() + 86400000);
    if (same(date, today)) return "today";
    if (same(date, tomorrow)) return "tomorrow";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  let host = null;
  let shadow = null;
  let panel = null;
  let busy = false;
  let lastRows = [];

  function build() {
    if (host) return;
    host = document.createElement("div");
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.append(style);

    const wrap = el("div", "wrap");
    const launcher = el("button", "launcher", "INBOUND");
    launcher.title = "Inbound packages (Alt+I)";
    launcher.addEventListener("click", togglePanel);
    wrap.append(launcher);
    shadow.append(wrap);
    document.documentElement.append(host);
  }

  function togglePanel() {
    if (panel) {
      panel.remove();
      panel = null;
      return;
    }
    panel = el("div", "panel");
    const header = el("header");
    header.append(el("span", "dot"));
    header.append(el("span", "", "INBOUND"));
    const count = el("span", "count", "");
    count.dataset.role = "count";
    header.append(count);
    header.append(el("span", "spacer"));
    const refresh = el("button", "", "REFRESH");
    refresh.addEventListener("click", () => load(true));
    const copy = el("button", "", "COPY JSON");
    copy.addEventListener("click", copyJson);
    const close = el("button", "", "CLOSE");
    close.addEventListener("click", togglePanel);
    header.append(refresh, copy, close);

    const body = el("div", "body");
    body.dataset.role = "body";
    body.append(el("div", "empty", "loading..."));
    const foot = el("div", "foot", "");
    foot.dataset.role = "foot";

    panel.append(header, body, foot);
    shadow.querySelector(".wrap").append(panel);
    load(true);
  }

  async function load() {
    if (busy) return;
    busy = true;
    const body = panel && panel.querySelector('[data-role="body"]');
    const foot = panel && panel.querySelector('[data-role="foot"]');
    const count = panel && panel.querySelector('[data-role="count"]');
    if (!body) {
      busy = false;
      return;
    }
    body.replaceChildren(el("div", "empty", "loading..."));

    const labelFilter = store.get("ups.label", DEFAULT_UPS_LABEL);
    const results = await Promise.allSettled([fetchUps(labelFilter), fetchFedex()]);
    const rows = [];
    const errors = [];
    let note = "";
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.note) note = result.value.note;
        rows.push(...result.value);
      } else {
        errors.push(String(result.reason && result.reason.message ? result.reason.message : result.reason));
      }
    }
    rows.sort((a, b) => {
      const ea = a.eta || "9999-12-31";
      const eb = b.eta || "9999-12-31";
      if (ea !== eb) return ea < eb ? -1 : 1;
      return a.carrier.localeCompare(b.carrier);
    });
    lastRows = rows;

    body.replaceChildren();
    if (!rows.length && !errors.length) {
      body.append(el("div", "empty", "nothing inbound"));
    }
    for (const row of rows) {
      const node = el("div", "row");
      node.append(el("div", `tag ${row.carrier === "FedEx" ? "fedex" : ""}`, row.carrier.toUpperCase()));
      const main = el("div", "main");
      main.append(el("div", "shipper", row.shipper));
      const meta = el("div", "meta");
      const track = el("span", "track", row.tracking || "no tracking");
      if (row.tracking) {
        track.title = "click to copy";
        track.addEventListener("click", () => {
          navigator.clipboard.writeText(row.tracking).catch(() => {});
          track.textContent = "copied";
          setTimeout(() => {
            track.textContent = row.tracking;
          }, 900);
        });
      }
      meta.append(track);
      if (row.address) meta.append(el("span", "", ` · ${row.address}`));
      main.append(meta);
      const side = el("div", "side");
      const eta = el("span", "eta", prettyDate(row.eta));
      eta.title = row.eta || "";
      side.append(eta);
      if (row.signature) side.append(el("span", "sig", "SIG"));
      node.append(main, side);
      body.append(node);
    }
    for (const message of errors) body.append(el("div", "error", message));

    if (count) count.textContent = rows.length ? `${rows.length} inbound` : "";
    if (foot) {
      const suffix = note ? ` · ${note}` : "";
      foot.textContent = `UPS ${labelFilter} · updated ${new Date().toLocaleTimeString()}${suffix}`;
    }
    busy = false;
  }

  function copyJson() {
    const payload = JSON.stringify({ generated: new Date().toISOString(), packages: lastRows }, null, 2);
    navigator.clipboard.writeText(payload).catch(() => {});
    const foot = panel && panel.querySelector('[data-role="foot"]');
    if (foot) foot.textContent = "copied JSON";
  }

  function boot() {
    build();
    window.addEventListener("keydown", (event) => {
      if (event.altKey && (event.key === "i" || event.key === "I")) {
        event.preventDefault();
        togglePanel();
      }
    }, true);
    try {
      GM_registerMenuCommand("Inbound packages", togglePanel);
      GM_registerMenuCommand("Reset UPS address cache", () => {
        store.set("ups.enrollments", []);
        store.set("ups.userName", "");
        lastRows = [];
        if (panel) {
          panel.remove();
          panel = null;
        }
        togglePanel();
      });
    } catch {
      /* ignore */
    }
  }

  installUpsHooks();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
