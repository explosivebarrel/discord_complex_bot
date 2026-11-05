// ==UserScript==
// @name         Discord Council Bot — Queue
// @namespace    dcbot-queue
// @version      @@VERSION@@
// @description  Add tracks to the Discord Council Bot queue right from YouTube, Yandex Music, SoundCloud and VK pages.
// @author       dcbot
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.yandex.ru/*
// @match        https://soundcloud.com/*
// @match        https://vk.com/*
// @match        https://vk.ru/*
// @match        https://m.vk.ru/*
// @match        https://music.vk.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @grant        GM_info
// @connect      *
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

/* The bot serves this file itself: @@SERVER@@ becomes the deployment's base
   URL, so install + updates need zero configuration beyond the API key.
   Pill click = queue the page's track. Hovering the pill opens a panel
   with every track/collection visible on the page (per-site scraping). */

(function () {
  "use strict";

  const SERVER = "@@SERVER@@";
  const LS = {
    server: "dcbot_server",
    key: "dcbot_key",
    guild: "dcbot_guild",
    guildName: "dcbot_guild_name",
  };

  const getServer = () => GM_getValue(LS.server, SERVER) || SERVER;
  const getKey = () => GM_getValue(LS.key, "");
  const getGuild = () => GM_getValue(LS.guild, "");
  const trim = (s) => (s || "").replace(/\s+/g, " ").trim();

  // In-script action journal: the hover-panel diagnostics dumps it, so a
  // failed attempt can be traced without any external tooling.
  const trace = [];
  const log = (s) => {
    const line = new Date().toLocaleTimeString() + " " + s;
    trace.push(line);
    if (trace.length > 40) trace.shift();
    return line;
  };

  // --- network -----------------------------------------------------------

  function api(method, path, body) {
    log("запрос " + method + " " + path);
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method,
        url: getServer() + path,
        headers: {
          Authorization: "Bearer " + getKey(),
          "Content-Type": "application/json",
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 20000,
        onload: (r) => {
          log("ответ " + r.status + " на " + path);
          let data = {};
          try {
            data = JSON.parse(r.responseText);
          } catch {
            /* non-JSON error body */
          }
          if (r.status >= 200 && r.status < 300) resolve(data);
          else reject(new Error(data.detail || "HTTP " + r.status));
        },
        onerror: (r) => {
          log("СЕТЕВАЯ ОШИБКА на " + path + ": " + (r.error || "?") + " status=" + r.status);
          reject(
            new Error(
              "Бот недоступен: " + getServer() +
              ". Если Tampermonkey спрашивал про доступ к домену — ответьте «разрешить всегда» (меню Tampermonkey → настройки → этому скрипту → домены).",
            ),
          );
        },
        ontimeout: () => reject(new Error("Таймаут запроса к боту")),
      });
    });
  }

  // --- VK: capture stream URLs from the page's own API traffic -----------
  // The VK web player plays blob: URLs, so the only way to get a playable
  // link is to hook the page's fetch/XHR and pick audio items out of the
  // JSON payloads it loads. Items land in vkCaptured (newest last); the
  // same payloads carry catalog playlists/albums (open-on-site rows).

  const VK_HOST = /^(vk\.com|m\.vk\.com|music\.vk\.com|vk\.ru|m\.vk\.ru|music\.vk\.ru|vkontakte\.ru)$/;
  const vkCaptured = []; // audio items {owner_id,id,url,title,artist,duration,key}
  const vkCollections = []; // catalog playlists {owner_id,id,title,key}
  const VK_MAX_ITEMS = 60;

  function vkRemember(item) {
    if (!item.url || !/^https?:\/\//.test(item.url) || /\.m3u8/i.test(item.url)) return;
    const key = item.owner_id != null && item.id != null ? `${item.owner_id}_${item.id}` : item.url;
    const row = { ...item, key, ms: Date.now() };
    const at = vkCaptured.findIndex((x) => x.key === key);
    if (at >= 0) vkCaptured.splice(at, 1);
    vkCaptured.push(row);
    if (vkCaptured.length > VK_MAX_ITEMS) vkCaptured.shift();
  }

  function vkScan(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(vkScan);
      return;
    }
    const hasId = value.owner_id != null && value.id != null;
    if (
      typeof value.url === "string" &&
      /\.mp3(\?|$)/.test(value.url) &&
      value.url.length < 1200 &&
      (value.title || value.artist)
    ) {
      vkRemember({
        owner_id: value.owner_id ?? null,
        id: value.id ?? null,
        url: value.url.startsWith("//") ? "https:" + value.url : value.url,
        title: trim(value.title),
        artist: trim(value.artist),
        duration: Number(value.duration) || 0,
      });
    } else if (hasId && typeof value.title === "string" && value.title && !value.url && !value.artist) {
      // Catalog playlist/album: an id-pair with a title but no playable URL.
      const key = `${value.owner_id}_${value.id}`;
      const row = { owner_id: value.owner_id, id: value.id, title: trim(value.title), key };
      const at = vkCollections.findIndex((x) => x.key === key);
      if (at < 0) {
        vkCollections.push(row);
        if (vkCollections.length > VK_MAX_ITEMS) vkCollections.shift();
      }
    }
    for (const k in value) vkScan(value[k]);
  }

  function vkScanText(text) {
    if (typeof text !== "string" || !text || text.length > 3_000_000) return;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return; // HTML fragments / non-JSON payloads are skipped
    }
    vkScan(data);
  }

  function initVkHook() {
    // The userscript runs in Tampermonkey's sandbox: the page's own
    // fetch/XHR live on unsafeWindow.
    const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    if (W.__dcbotVkHook) return;
    W.__dcbotVkHook = true;
    const origFetch = W.fetch;
    if (typeof origFetch === "function") {
      W.fetch = function (...args) {
        const p = origFetch.apply(this, args);
        try {
          p.then((res) => {
            try {
              const ct = String((res.headers && res.headers.get && res.headers.get("content-type")) || "");
              if (!ct || ct.includes("json") || ct.includes("text")) {
                res.clone().text().then(vkScanText).catch(() => {});
              }
            } catch {}
          }).catch(() => {});
        } catch {}
        return p;
      };
    }
    const XHR = W.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const open = XHR.prototype.open;
      const send = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__dcbotUrl = url;
        return open.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        this.addEventListener("load", () => {
          try {
            if (/audio|method\/|al_audio/.test(String(this.__dcbotUrl || this.responseURL || ""))) {
              vkScanText(this.responseText);
            }
          } catch {}
        });
        return send.apply(this, arguments);
      };
    }
  }

  // --- page scrapers ------------------------------------------------------
  // Each returns { tracks, collections, artists } — the content actually
  // visible on the page, for the hover panel.

  function ytCardTitle(a) {
    // The title sits in a #video-title node inside the video card; the
    // anchor around the thumbnail only wraps the duration badge, so its
    // text is "3:53" — exactly why the panel showed durations.
    const scope =
      a.closest("ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model, ytm-rich-item-renderer, ytd-compact-video-renderer") ||
      a.parentElement ||
      a;
    const node = scope.querySelector("#video-title, h3 a, h3 span, a[title]");
    const title = trim(node && (node.getAttribute("title") || node.textContent));
    if (!title || /^([0-9]{1,2}:)?[0-9]{1,2}:[0-9]{2}$/.test(title)) return "";
    return title;
  }

  function scrapeYouTube() {
    const tracks = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/[?&]v=([\w-]{6,})/);
      if (!m || seen.has(m[1])) continue;
      const title = ytCardTitle(a);
      if (!title) continue;
      seen.add(m[1]);
      tracks.push({ query: "https://www.youtube.com/watch?v=" + m[1], source: "yt", title: title.slice(0, 140) });
      if (tracks.length >= 40) break;
    }
    const collections = [];
    const seenPl = new Set();
    for (const a of document.querySelectorAll('a[href*="/playlist?list="]')) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/[?&]list=([\w-]+)/);
      if (!m || seenPl.has(m[1])) continue;
      const label = trim(a.getAttribute("title") || a.textContent);
      if (!label) continue;
      seenPl.add(m[1]);
      collections.push({ query: "https://www.youtube.com/playlist?list=" + m[1], label: label.slice(0, 140), kind: "playlist" });
      if (collections.length >= 40) break;
    }
    return { tracks, collections, artists: [] };
  }

  function scrapeYandex() {
    const abs = (href) => location.origin + href;
    const tracks = [];
    const collections = [];
    const artists = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/track/"]')) {
      const href = (a.getAttribute("href") || "").split("?")[0];
      if (!/^\/(album\/\d+\/)?track\/\d+/.test(href)) continue;
      if (seen.has(href)) continue;
      const label = trim(a.textContent);
      if (!label) continue;
      seen.add(href);
      tracks.push({ query: abs(href), source: "ym", title: label.slice(0, 140) });
      if (tracks.length >= 40) break;
    }
    for (const a of document.querySelectorAll('a[href*="/album/"], a[href*="/playlists/"]')) {
      const href = (a.getAttribute("href") || "").split("?")[0];
      if (!/^\/album\/\d+$/.test(href) && !/^\/users\/\d+\/playlists\/\d+$/.test(href) && !/^\/playlists\/\d+/.test(href)) continue;
      if (seen.has(href)) continue;
      const label = trim(a.getAttribute("title") || a.textContent);
      if (!label) continue;
      seen.add(href);
      collections.push({ query: abs(href), label: label.slice(0, 140), kind: href.includes("/album/") ? "album" : "playlist" });
      if (collections.length >= 40) break;
    }
    for (const a of document.querySelectorAll('a[href*="/artist/"]')) {
      const href = (a.getAttribute("href") || "").split("?")[0];
      if (!/^\/artist\/\d+$/.test(href)) continue;
      if (seen.has(href)) continue;
      const label = trim(a.getAttribute("title") || a.textContent);
      if (!label) continue;
      seen.add(href);
      artists.push({ url: abs(href), label: label.slice(0, 140) });
      if (artists.length >= 30) break;
    }
    return { tracks, collections, artists };
  }

  function scrapeVK() {
    // The hook already knows the audio (and catalog playlist) items the
    // page loaded — newest first, since the player prefetches the catalog.
    const tracks = [...vkCaptured].reverse().map((x) => ({
      query: x.owner_id != null && x.id != null ? `https://vk.ru/audio${x.owner_id}_${x.id}` : location.href,
      source: "vk",
      title: [x.artist, x.title].filter(Boolean).join(" — ").slice(0, 140) || "(без названия)",
      author: x.artist || undefined,
      length_ms: x.duration ? x.duration * 1000 : undefined,
      stream_url: x.url,
    }));
    const collections = vkCollections.slice(-40).reverse().map((x) => ({
      query: `https://vk.ru/playlist${x.owner_id}_${x.id}`,
      label: x.title,
      kind: "playlist",
      openOnly: true, // VK playlist enqueue needs a server token — open instead
    }));
    return { tracks, collections, artists: [] };
  }

  const SCRAPERS = [
    [/(^|\.)youtube\.com$/, scrapeYouTube],
    [/^music\.yandex\.ru$/, scrapeYandex],
    [/(^|\.)soundcloud\.com$/, () => ({ tracks: [], collections: [], artists: [] })],
    [VK_HOST, scrapeVK],
  ];

  function scrapePage() {
    const host = location.hostname.replace(/^www\./, "");
    for (const [pattern, fn] of SCRAPERS) {
      if (pattern.test(host)) {
        try {
          return fn();
        } catch (e) {
          console.warn("[dcbot-queue] scraper failed:", e);
          return { tracks: [], collections: [], artists: [] };
        }
      }
    }
    return { tracks: [], collections: [], artists: [] };
  }

  // --- current-page extractor (the pill click) ----------------------------
  // Returns { query, source, title, author, length_ms, artwork, stream_url }
  // or null when this page is not a track/playlist.

  function extractYouTube() {
    const url = new URL(location.href);
    const list = url.searchParams.get("list");
    const v = url.searchParams.get("v") || (location.pathname.match(/^\/(shorts|watch)\/([\w-]{6,})/) || [])[2];
    if (list && (!v || location.pathname === "/playlist")) {
      return { query: "https://www.youtube.com/playlist?list=" + list, source: "yt" };
    }
    if (!v) return null;
    const details =
      window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails
        ? window.ytInitialPlayerResponse.videoDetails
        : null;
    const row = { query: "https://www.youtube.com/watch?v=" + v, source: "yt" };
    if (details) {
      row.title = details.title;
      row.author = details.author;
      row.length_ms = details.lengthSeconds ? Number(details.lengthSeconds) * 1000 : undefined;
      const thumbs = details.thumbnail && details.thumbnail.thumbnails;
      if (thumbs && thumbs.length) row.artwork = thumbs[thumbs.length - 1].url;
    } else {
      row.title = document.title.replace(/ - YouTube$/, "").trim();
    }
    return row;
  }

  function extractYandex() {
    // The server rewrites music.yandex.ru -> .com for the Lavalink plugin,
    // so send whatever the user sees. Albums/playlists open as a preview.
    const p = location.pathname;
    const track = p.match(/^\/(album\/(\d+)\/)?track\/(\d+)/);
    if (track) {
      return {
        query: location.origin + (track[2] ? "/album/" + track[2] : "") + "/track/" + track[3],
        source: "ym",
      };
    }
    if (/^\/album\/\d+/.test(p) || /^\/users\/\d+\/playlists\/\d+/.test(p) || /^\/playlists\//.test(p)) {
      return { query: location.origin + p, source: "ym" };
    }
    return null;
  }

  function extractSoundCloud() {
    if (location.pathname === "/" || location.pathname.split("/").filter(Boolean).length < 2) return null;
    return { query: location.origin + location.pathname, source: "sc" };
  }

  function extractVK() {
    const path = location.pathname;
    const track = path.match(/audio(-?\d+)_(\d+)/);
    let picked = null;
    if (track) {
      const owner = Number(track[1]);
      const id = Number(track[2]);
      picked = vkCaptured.find((x) => x.owner_id === owner && x.id === id) || null;
    }
    if (!picked && vkCaptured.length) {
      // No permalink context (the player page): the track the page loaded
      // most recently is the one being listened to.
      picked = vkCaptured[vkCaptured.length - 1];
    }
    if (!picked) return null;
    const title = [picked.artist, picked.title].filter(Boolean).join(" — ");
    return {
      query: location.origin + location.pathname,
      source: "vk",
      stream_url: picked.url,
      title: title || undefined,
      author: picked.artist || undefined,
      length_ms: picked.duration ? picked.duration * 1000 : undefined,
    };
  }

  const EXTRACTORS = [
    [/(^|\.)youtube\.com$/, extractYouTube],
    [/^music\.yandex\.ru$/, extractYandex],
    [/(^|\.)soundcloud\.com$/, extractSoundCloud],
    [VK_HOST, extractVK],
  ];

  function extract() {
    const host = location.hostname.replace(/^www\./, "");
    for (const [pattern, fn] of EXTRACTORS) {
      if (pattern.test(host)) {
        try {
          return fn();
        } catch (e) {
          console.warn("[dcbot-queue] extractor failed:", e);
          return null;
        }
      }
    }
    return null;
  }

  // --- queueing -----------------------------------------------------------

  async function sendQueue(body) {
    log("sendQueue: " + body.source + " " + (body.title || body.query || "").slice(0, 60));
    if (!(await requireConfig())) return false;
    setPill("busy");
    try {
      const r = await api("POST", "/api/extension/queue/" + getGuild(), body);
      const where = GM_getValue(LS.guildName, "");
      const count = r.queued && r.queued > 1 ? ` (${r.queued} трек.)` : "";
      toast("В очереди: " + (r.title || "") + count + (where ? " → " + where : ""));
      return true;
    } catch (e) {
      toast(String(e.message || e), true);
      return false;
    } finally {
      setPill("idle");
    }
  }

  async function requireConfig() {
    if (!getKey()) {
      toast("Ключ не задан: меню Tampermonkey → «Discord Queue: настройки»", true);
      return false;
    }
    if (!getGuild()) {
      // The common setup footgun: the guild prompt was cancelled. With a
      // single guild there is nothing to choose — pick it silently.
      try {
        const guilds = await api("GET", "/api/my/guilds");
        if (guilds.length === 1) {
          GM_setValue(LS.guild, guilds[0].id);
          GM_setValue(LS.guildName, guilds[0].name);
          return true;
        }
      } catch {}
      toast("Гильдия не выбрана: меню Tampermonkey → «Discord Queue: настройки»", true);
      return false;
    }
    return true;
  }

  async function enqueueCurrent() {
    if (!(await requireConfig())) return;
    const row = extract();
    if (!row) {
      const host = location.hostname.replace(/^www\./, "");
      toast(
        /vk\.|vkontakte/.test(host)
          ? "VK не отдал ссылку. Открой в VK любой трек (нажми play в плеере) и нажми кнопку ещё раз."
          : "На этой странице не найден трек или плейлист",
        true,
      );
      return;
    }
    await sendQueue({
      query: row.query,
      source: row.source,
      title: row.title,
      author: row.author,
      length_ms: row.length_ms,
      artwork: row.artwork,
      stream_url: row.stream_url,
    });
  }

  // --- UI -----------------------------------------------------------------

  const CSS = `
    #dcbot-wrap{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;flex-direction:column;
      align-items:flex-end;gap:10px;font:400 13px/1.4 Roboto,system-ui,sans-serif}
    #dcbot-panel{display:none;width:320px;max-height:46vh;background:#201a33;color:#e7e1f5;
      border:1px solid #453f63;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.55);overflow:hidden;
      flex-direction:column}
    #dcbot-panel.open{display:flex}
    #dcbot-panel .dcbot-head{padding:9px 12px;font-weight:500;font-size:12px;color:#b7ace0;
      border-bottom:1px solid #35305a;text-transform:uppercase;letter-spacing:.4px;display:flex;
      justify-content:space-between;align-items:center}
    #dcbot-panel .dcbot-body{overflow-y:auto;padding:4px 0 8px}
    #dcbot-panel .dcbot-cat{padding:7px 12px 3px;font-size:11px;font-weight:500;color:#8f83bd;
      text-transform:uppercase;letter-spacing:.5px}
    #dcbot-panel .dcbot-row{padding:6px 12px;cursor:pointer;display:block;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis}
    #dcbot-panel .dcbot-row:hover{background:#322a52}
    #dcbot-panel .dcbot-row .dcbot-kind{color:#8f83bd;font-size:11px;margin-left:6px}
    #dcbot-panel .dcbot-empty{padding:8px 12px;color:#8f83bd}
    #dcbot-pill{display:flex;align-items:center;gap:6px;background:#1f1b2e;color:#e7e1f5;
      border:1px solid #453f63;border-radius:999px;padding:8px 14px;
      font:500 13px/1 Roboto,system-ui,sans-serif;cursor:pointer;user-select:none;
      box-shadow:0 6px 18px rgba(0,0,0,.45);opacity:.82;transition:opacity .15s}
    #dcbot-pill:hover{opacity:1}
    #dcbot-pill.busy{opacity:.6;pointer-events:none}
    #dcbot-toast{position:fixed;right:18px;bottom:64px;z-index:2147483647;max-width:340px;
      background:#241f36;color:#efe9ff;border:1px solid #453f63;border-radius:10px;padding:10px 14px;
      font:400 13px/1.4 Roboto,system-ui,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.5);
      transition:opacity .25s, transform .25s;opacity:0;transform:translateY(6px);pointer-events:none}
    #dcbot-toast.show{opacity:1;transform:translateY(0)}
    #dcbot-toast.err{border-color:#8c3d50;background:#2e1b26}
  `;

  function toast(text, isErr) {
    let el = document.getElementById("dcbot-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "dcbot-toast";
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.className = "show" + (isErr ? " err" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 5000);
  }

  function ensureUi() {
    if (document.getElementById("dcbot-wrap")) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.documentElement.appendChild(style);

    const wrap = document.createElement("div");
    wrap.id = "dcbot-wrap";

    const panel = document.createElement("div");
    panel.id = "dcbot-panel";

    const pill = document.createElement("div");
    pill.id = "dcbot-pill";
    pill.textContent = "＋ Queue";
    pill.title = "Добавить трек страницы в очередь; наведи — треки со страницы";
    pill.addEventListener("click", enqueueCurrent);

    wrap.appendChild(panel);
    wrap.appendChild(pill);
    document.documentElement.appendChild(wrap);

    // Hover intent: opening on hover, closing shortly after leaving both
    // the pill and the panel.
    let hideTimer = 0;
    const open = () => {
      clearTimeout(hideTimer);
      renderPanel();
      panel.classList.add("open");
    };
    const closeSoon = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => panel.classList.remove("open"), 400);
    };
    pill.addEventListener("mouseenter", open);
    panel.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    pill.addEventListener("mouseleave", closeSoon);
    panel.addEventListener("mouseleave", closeSoon);
  }

  function rowEl(label, kindTag, onClick) {
    const el = document.createElement("div");
    el.className = "dcbot-row";
    el.textContent = label;
    if (kindTag) {
      const tag = document.createElement("span");
      tag.className = "dcbot-kind";
      tag.textContent = kindTag;
      el.appendChild(tag);
    }
    el.addEventListener("click", onClick);
    return el;
  }

  function renderPanel() {
    const panel = document.getElementById("dcbot-panel");
    if (!panel) return;
    const body = document.createElement("div");
    body.className = "dcbot-body";
    const page = scrapePage();

    const head = document.createElement("div");
    head.className = "dcbot-head";
    const title = document.createElement("span");
    title.textContent = "На странице";
    const hint = document.createElement("span");
    hint.textContent = "клик — в очередь";
    hint.style.color = "#6f6599";
    head.appendChild(title);
    head.appendChild(hint);

    if (page.tracks.length) {
      const cat = document.createElement("div");
      cat.className = "dcbot-cat";
      cat.textContent = "Треки";
      body.appendChild(cat);
      for (const t of page.tracks) {
        body.appendChild(
          rowEl(t.title || t.query, t.source ? t.source.toUpperCase() : undefined, () => {
            log("клик по треку из панели: " + (t.title || t.query).slice(0, 50));
            panel.classList.remove("open");
            sendQueue({
              query: t.query,
              source: t.source,
              title: t.title,
              author: t.author,
              length_ms: t.length_ms,
              artwork: t.artwork,
              stream_url: t.stream_url,
            });
          }),
        );
      }
    }
    if (page.collections.length) {
      const cat = document.createElement("div");
      cat.className = "dcbot-cat";
      cat.textContent = "Альбомы и плейлисты";
      body.appendChild(cat);
      for (const c of page.collections) {
        body.appendChild(
          rowEl(
            c.label,
            c.kind === "album" ? "альбом" : "плейлист",
            () => {
              panel.classList.remove("open");
              if (c.openOnly) window.open(c.query, "_blank");
              else sendQueue({ query: c.query, source: location.hostname.includes("yandex") ? "ym" : "yt" });
            },
          ),
        );
      }
    }
    if (page.artists.length) {
      const cat = document.createElement("div");
      cat.className = "dcbot-cat";
      cat.textContent = "Исполнители (откроется на сайте)";
      body.appendChild(cat);
      for (const a of page.artists) {
        body.appendChild(
          rowEl(a.label, undefined, () => {
            window.open(a.url, "_blank");
          }),
        );
      }
    }
    if (!page.tracks.length && !page.collections.length && !page.artists.length) {
      const empty = document.createElement("div");
      empty.className = "dcbot-empty";
      empty.textContent = "На странице не нашлось треков и коллекций.";
      body.appendChild(empty);
    }

    panel.replaceChildren(head, body);
  }

  // SPA sites navigate without reloads — keep the pill mounted.
  const observer = new MutationObserver(() => ensureUi());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensureUi();

  if (VK_HOST.test(location.hostname.replace(/^www\./, ""))) initVkHook();

  // --- menu ---------------------------------------------------------------

  function ask(label, current) {
    const v = prompt(label, current);
    return v === null ? undefined : v.trim();
  }

  async function pickGuild() {
    if (!getKey()) {
      toast("Сначала задайте ключ", true);
      return;
    }
    try {
      const guilds = await api("GET", "/api/my/guilds");
      if (!guilds.length) {
        toast("Бот не нашёл серверов, где вы вместе с ним", true);
        return;
      }
      const list = guilds.map((g, i) => `${i + 1}. ${g.name}`).join("\n");
      const pick = prompt("Выберите сервер (номер):\n" + list, "1");
      if (!pick) return;
      const idx = Number(pick) - 1;
      const g = guilds[idx];
      if (!g) return;
      GM_setValue(LS.guild, g.id);
      GM_setValue(LS.guildName, g.name);
      toast("Сервер: " + g.name);
    } catch (e) {
      toast(String(e.message || e), true);
    }
  }

  function configure() {
    const server = ask("Адрес бота (например, " + SERVER + "):", getServer());
    if (server === undefined) return;
    if (server) GM_setValue(LS.server, server.replace(/\/+$/, ""));
    const key = ask("Персональный ключ (vkq_…, выдаётся в панели на /extension):", getKey());
    if (key === undefined) return;
    if (key) GM_setValue(LS.key, key);
    if (getKey()) pickGuild();
  }

  function checkConnection() {
    if (!requireConfig()) return;
    api("GET", "/api/my/guilds")
      .then((guilds) => {
        const g = guilds.find((x) => x.id === getGuild());
        toast(g ? "Связь ок, сервер: " + g.name : "Связь ок, но выбранный сервер недоступен", !g);
      })
      .catch((e) => toast(String(e.message || e), true));
  }

  async function diagnostics() {
    const L = [];
    L.push("=== Discord Queue: диагностика ===");
    L.push("Скрипт: v" + (typeof GM_info !== "undefined" && GM_info.script ? GM_info.script.version : "?") +
      " (Tampermonkey " + (typeof GM_info !== "undefined" ? GM_info.version : "?") + ")");
    L.push("Сервер: " + getServer());
    L.push("Ключ: " + (getKey() ? getKey().slice(0, 8) + "… (" + getKey().length + " симв.)" : "НЕ ЗАДАН"));
    L.push("Гильдия: " + (getGuild() || "не выбрана") +
      (GM_getValue(LS.guildName, "") ? " (" + GM_getValue(LS.guildName, "") + ")" : ""));
    L.push("Страница: " + location.href);
    if (VK_HOST.test(location.hostname)) L.push("VK перехват: " + vkCaptured.length + " треков, " + vkCollections.length + " коллекций");
    const result = await new Promise((resolve) => {
      GM.xmlHttpRequest({
        method: "GET",
        url: getServer() + "/api/my/guilds",
        headers: { Authorization: "Bearer " + getKey() },
        timeout: 15000,
        onload: (r) => {
          let names = "";
          try {
            names = JSON.parse(r.responseText).map((x) => x.name).join(", ");
          } catch {
            names = r.responseText.slice(0, 120);
          }
          resolve("HTTP " + r.status + (names ? "; сервера бота: " + names : "; " + names));
        },
        onerror: (r) =>
          resolve(
            "СЕТЕВАЯ ОШИБКА (запрос не покинул браузер): status=" + r.status +
            " error=" + (r.error || "?") +
            " → Tampermonkey блокирует домен. Меню Tampermonkey → настройки → этот скрипт → раздел доменов: убери запреты на адрес сервера, либо удали скрипт и поставь заново со страницы /extension.",
          ),
        ontimeout: () => resolve("ТАЙМАУТ запроса (15 c)"),
      });
    });
    L.push("GET /api/my/guilds → " + result);
    L.push("--- журнал действий (свежее внизу) ---");
    if (trace.length) L.push(trace.join("\n")); else L.push("пусто — попыток с момента загрузки страницы не было");
    L.push("Пришли этот отчёт целиком.");
    alert(L.join("\n"));
  }
  GM_registerMenuCommand("Discord Queue: настройки", configure);
  GM_registerMenuCommand("Discord Queue: проверить связь", checkConnection);
  GM_registerMenuCommand("Discord Queue: диагностика", diagnostics);
})();
