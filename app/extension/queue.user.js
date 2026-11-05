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
// @grant        GM_setClipboard
// @grant        GM_info
// @grant        unsafeWindow
// @connect      *
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

/* The bot serves this file itself: @@SERVER@@ becomes the deployment's base
   URL, so install + updates need zero configuration beyond the API key.
   Pill click = queue the page's track. Hovering the pill opens a panel
   with two tabs: "Треки" (the page's tracks/collections) and "Лог" (the
   full session log: requests, responses, errors with stacks). */

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

  // --- session log --------------------------------------------------------
  // Everything the script does lands here: requests, responses, errors with
  // stacks, captures, clicks. The panel's "Лог" tab shows it live; copy
  // buttons hand it over as text or JSON.

  const LOGS = []; // {ts, level, msg, data?}
  const LOG_CAP = 400;
  let logSeq = 0;
  let activeTab = "queue"; // queue | log

  function log(msg, level = "info", data) {
    const entry = {
      ts: new Date().toISOString(),
      n: ++logSeq,
      level,
      msg: typeof msg === "string" ? msg : String(msg),
    };
    if (data !== undefined) {
      entry.data = data instanceof Error ? { message: data.message, stack: data.stack } : data;
    }
    LOGS.push(entry);
    if (LOGS.length > LOG_CAP) LOGS.shift();
    if (activeTab === "log") renderPanel();
    return entry;
  }

  function logErr(context, err) {
    return log(context + ": " + (err && err.message ? err.message : String(err)), "err", {
      stack: err && err.stack ? String(err.stack).split("\n").slice(0, 4).join("\n") : undefined,
    });
  }

  // Uncaught errors and rejections land in the session log too: a
  // silent death between a click and the request was exactly what
  // made the previous debugging blind.
  function installErrorTraps() {
    try {
      window.addEventListener("error", (e) => {
        log("НЕПЕРЕХВАЧЕНА ОШИБКА: " + e.message + " @" + (e.filename || "?") + ":" + (e.lineno || "?"), "err", {
          stack: e.error && e.error.stack ? String(e.error.stack).split("\n").slice(0, 4).join("\n") : undefined,
        });
      });
      window.addEventListener("unhandledrejection", (e) => {
        const r = e.reason;
        log("НЕОБРАБОТАННЫЙ REJECTION: " + (r && r.message ? r.message : String(r)), "err", {
          stack: r && r.stack ? String(r.stack).split("\n").slice(0, 4).join("\n") : undefined,
        });
      });
      log("глобальные ловушки ошибок установлены");
    } catch (e) {
      /* traps are diagnostic, never fatal */
    }
  }

  function fmtTs(iso) {
    return (iso || "").slice(11, 23);
  }

  function logsAsText() {
    return LOGS.map(
      (l) => `[${fmtTs(l.ts)}] [${l.level.toUpperCase()}] ${l.msg}` + (l.data ? ` | ${JSON.stringify(l.data)}` : "")
    ).join("\n");
  }

  function logsAsJson() {
    return JSON.stringify({ script: "dcbot-queue", version: typeof GM_info !== "undefined" && GM_info.script ? GM_info.script.version : "?", page: location.href, logs: LOGS }, null, 2);
  }

  // --- network ------------------------------------------------------------

  function api(method, path, body) {
    const t0 = performance.now();
    log(`→ ${method} ${path}` + (body ? ` ${JSON.stringify(body).slice(0, 160)}` : ""));
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
          const ms = Math.round(performance.now() - t0);
          let data = {};
          try {
            data = JSON.parse(r.responseText);
          } catch {
            /* non-JSON error body */
          }
          if (r.status >= 200 && r.status < 300) {
            log(`← ${r.status} ${path} (${ms} мс) ${JSON.stringify(data).slice(0, 160)}`);
            resolve(data);
          } else {
            log(`← ${r.status} ${path} (${ms} мс) ${r.responseText.slice(0, 200)}`, "err");
            reject(new Error(data.detail || "HTTP " + r.status));
          }
        },
        onerror: (r) => {
          log(
            `← СЕТЕВАЯ ОШИБКА ${path}: status=${r.status} error=${r.error || "?"} — Tampermonkey не отправил запрос` +
              " (меню Tampermonkey → настройки → этот скрипт → домены: адрес сервера должен быть разрешён)",
            "err",
          );
          reject(
            new Error(
              "Бот недоступен: " + getServer() +
              ". Если Tampermonkey спрашивал про доступ к домену — ответьте «разрешить всегда» (меню Tampermonkey → настройки → этому скрипту → домены).",
            ),
          );
        },
        ontimeout: () => {
          log(`← ТАЙМАУТ ${path} (20 с)`, "err");
          reject(new Error("Таймаут запроса к боту"));
        },
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
    // Every capture would flood the log on catalog prefetch: log the first
    // few and the ones arriving after a pause (likely actual plays).
    if (vkRemember._n === undefined) vkRemember._n = 0;
    if (vkRemember._n < 5 || Date.now() - (vkRemember._last || 0) > 4000) {
      vkRemember._last = Date.now();
      vkRemember._n++;
      log(`VK: захвачен трек ${[item.artist, item.title].filter(Boolean).join(" — ").slice(0, 60)}`);
    }
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
      const cover =
        (value.album && (value.album.thumb || value.album.coverUrl)) ||
        value.thumb ||
        value.coverUrl ||
        null;
      vkRemember({
        owner_id: value.owner_id ?? null,
        id: value.id ?? null,
        url: value.url.startsWith("//") ? "https:" + value.url : value.url,
        title: trim(value.title),
        artist: trim(value.artist),
        duration: Number(value.duration) || 0,
        artwork: typeof cover === "string" && cover.startsWith("//") ? "https:" + cover : cover,
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
    log("VK: перехват fetch/XHR установлен");
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
      artwork: x.artwork || undefined,
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
          logErr("скрейп страницы упал", e);
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
      artwork: picked.artwork || undefined,
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
          logErr("экстрактор упал", e);
          return null;
        }
      }
    }
    return null;
  }

  // --- queueing -----------------------------------------------------------

  async function sendQueue(body) {
    try {
      if (!(await requireConfig())) return false;
      setPill("busy");
      const r = await api("POST", "/api/extension/queue/" + getGuild(), body);
      const where = GM_getValue(LS.guildName, "");
      const count = r.queued && r.queued > 1 ? ` (${r.queued} трек.)` : "";
      const text = "В очереди: " + (r.title || "") + count + (where ? " → " + where : "");
      log("успех: " + text);
      toast(text);
      return true;
    } catch (e) {
      logErr("отказ очереди", e);
      toast(String(e.message || e), true);
      return false;
    } finally {
      setPill("idle");
    }
  }

  function requireConfig() {
    try {
      const hasKey = !!getKey();
      const hasGuild = !!getGuild();
      log("конфиг: ключ=" + (hasKey ? "есть" : "НЕТ") + " гильдия=" + (hasGuild ? "есть" : "НЕТ"));
      if (!hasKey) {
        const m = "Ключ не задан: меню Tampermonkey → «Discord Queue: настройки»";
        log(m, "warn");
        toast(m, true);
        return Promise.resolve(false);
      }
      if (!hasGuild) {
        // The common setup footgun: the guild prompt was cancelled. With a
        // single guild there is nothing to choose — pick it silently.
        return api("GET", "/api/my/guilds")
          .then((guilds) => {
            if (guilds.length === 1) {
              GM_setValue(LS.guild, guilds[0].id);
              GM_setValue(LS.guildName, guilds[0].name);
              log("гильдия выбрана автоматически: " + guilds[0].name);
              return true;
            }
            const m = "Гильдия не выбрана: меню Tampermonkey → «Discord Queue: настройки»";
            log(m, "warn");
            toast(m, true);
            return false;
          })
          .catch((e) => {
            logErr("автовыбор гильдии не удался", e);
            toast(String(e.message || e), true);
            return false;
          });
      }
      return Promise.resolve(true);
    } catch (e) {
      logErr("проверка конфигурации упала", e);
      return Promise.resolve(false);
    }
  }

  async function enqueueCurrent() {
    log("клик по пилюле, url=" + location.href);
    const row = extract();
    log("экстрактор страницы: " + (row ? row.source + " " + (row.title || row.query) : "ничего"));
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
    #dcbot-panel{display:none;width:380px;max-height:52vh;background:#201a33;color:#e7e1f5;
      border:1px solid #453f63;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.55);overflow:hidden;
      flex-direction:column}
    #dcbot-panel.open{display:flex}
    #dcbot-panel .dcbot-head{padding:6px 8px 6px 12px;font-size:12px;border-bottom:1px solid #35305a;
      display:flex;gap:6px;align-items:center}
    .dcbot-tab{padding:4px 10px;border-radius:8px;cursor:pointer;color:#8f83bd;user-select:none;white-space:nowrap}
    .dcbot-tab.on{background:#3a2f63;color:#efe9ff;font-weight:500}
    #dcbot-panel .dcbot-body{overflow-y:auto;padding:4px 0 8px;flex:1;min-height:0}
    #dcbot-panel .dcbot-cat{padding:7px 12px 3px;font-size:11px;font-weight:500;color:#8f83bd;
      text-transform:uppercase;letter-spacing:.5px}
    #dcbot-panel .dcbot-row{padding:6px 12px;cursor:pointer;display:block;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis}
    #dcbot-panel .dcbot-row:hover{background:#322a52}
    #dcbot-panel .dcbot-row .dcbot-kind{color:#8f83bd;font-size:11px;margin-left:6px}
    #dcbot-panel .dcbot-empty{padding:8px 12px;color:#8f83bd}
    #dcbot-log{font:400 11px/1.5 ui-monospace,Consolas,monospace;word-break:break-all}
    .dcbot-lrow{padding:2px 12px;border-bottom:1px solid #2a2444;white-space:pre-wrap}
    .dcbot-lrow .lt{color:#6f6599}
    .dcbot-lrow.err{color:#ff9aa8}
    .dcbot-lrow.warn{color:#ffd08a}
    #dcbot-logbar{display:flex;gap:6px;padding:6px 12px;border-bottom:1px solid #35305a}
    #dcbot-logbar .dcbot-tab{font-size:11px;padding:3px 8px}
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

  function setPill(state) {
    const pill = document.getElementById("dcbot-pill");
    if (!pill) return;
    pill.classList.toggle("busy", state === "busy");
    pill.textContent = state === "busy" ? "…" : "＋ Queue";
  }

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
    pill.title = "Добавить трек страницы в очередь; наведи — треки со страницы и лог";
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
    log(
      "скрипт инициализирован, host=" + location.hostname +
      "; GM: xmlHttpRequest=" + (typeof GM !== "undefined" && GM.xmlHttpRequest ? "ok" : "ОТСУТСТВУЕТ") +
      " setValue=" + (typeof GM_setValue === "function" ? "ok" : "ОТСУТСТВУЕТ") +
      " getValue=" + (typeof GM_getValue === "function" ? "ok" : "ОТСУТСТВУЕТ")
    );
    installErrorTraps();
  }

  function tabEl(label, tabId) {
    const el = document.createElement("span");
    el.className = "dcbot-tab" + (activeTab === tabId ? " on" : "");
    el.textContent = label;
    el.addEventListener("click", () => {
      activeTab = tabId;
      renderPanel();
    });
    return el;
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

  function copyLog(asJson) {
    const text = asJson ? logsAsJson() : logsAsText();
    try {
      GM_setClipboard(text);
      toast(asJson ? "Лог скопирован (JSON)" : "Лог скопирован (текст)");
    } catch (e) {
      // Clipboard permission refused: the manual way.
      prompt("Скопируй лог вручную:", text);
    }
  }

  function renderPanel() {
    const panel = document.getElementById("dcbot-panel");
    if (!panel) return;

    const head = document.createElement("div");
    head.className = "dcbot-head";
    head.appendChild(tabEl("Треки", "queue"));
    head.appendChild(tabEl("Лог (" + LOGS.length + ")", "log"));

    if (activeTab === "log") {
      const bar = document.createElement("div");
      bar.id = "dcbot-logbar";
      const bText = document.createElement("span");
      bText.className = "dcbot-tab";
      bText.textContent = "Копировать текст";
      bText.addEventListener("click", () => copyLog(false));
      const bJson = document.createElement("span");
      bJson.className = "dcbot-tab";
      bJson.textContent = "Копировать JSON";
      bJson.addEventListener("click", () => copyLog(true));
      const bClear = document.createElement("span");
      bClear.className = "dcbot-tab";
      bClear.textContent = "Очистить";
      bClear.addEventListener("click", () => {
        LOGS.length = 0;
        log("лог очищен");
        renderPanel();
      });
      bar.appendChild(bText);
      bar.appendChild(bJson);
      bar.appendChild(bClear);

      const body = document.createElement("div");
      body.className = "dcbot-body";
      body.id = "dcbot-log";
      if (!LOGS.length) {
        const empty = document.createElement("div");
        empty.className = "dcbot-empty";
        empty.textContent = "Пока пусто: попробуй добавить трек — всё появится здесь.";
        body.appendChild(empty);
      }
      for (const l of LOGS.slice().reverse()) {
        const row = document.createElement("div");
        row.className = "dcbot-lrow " + (l.level === "err" ? "err" : l.level === "warn" ? "warn" : "");
        row.textContent = "[" + fmtTs(l.ts) + "] " + l.msg + (l.data ? "  ⋮ " + JSON.stringify(l.data) : "");
        body.appendChild(row);
      }
      panel.replaceChildren(head, bar, body);
      return;
    }

    const body = document.createElement("div");
    body.className = "dcbot-body";
    const page = scrapePage();
    if (page.tracks.length) {
      const cat = document.createElement("div");
      cat.className = "dcbot-cat";
      cat.textContent = "Треки";
      body.appendChild(cat);
      for (const t of page.tracks) {
        body.appendChild(
          rowEl(t.title || t.query, t.source ? t.source.toUpperCase() : undefined, () => {
            log("клик по треку из панели: " + (t.title || t.query).slice(0, 60));
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

  // SPA sites navigate without reloads — keep the pill mounted and log the
  // URL the script lives on now.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log("переход: " + location.href);
    }
  }, 1500);
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
    if (!getKey()) {
      toast("Ключ не задан", true);
      return;
    }
    api("GET", "/api/my/guilds")
      .then((guilds) => {
        const g = guilds.find((x) => x.id === getGuild());
        toast(g ? "Связь ок, сервер: " + g.name : "Связь ок, но выбранный сервер недоступен", !g);
      })
      .catch((e) => toast(String(e.message || e), true));
  }

  GM_registerMenuCommand("Discord Queue: настройки", configure);
  GM_registerMenuCommand("Discord Queue: проверить связь", checkConnection);
  GM_registerMenuCommand("Discord Queue: скопировать лог (текст)", () => copyLog(false));
  GM_registerMenuCommand("Discord Queue: скопировать лог (JSON)", () => copyLog(true));
})();
