// ==UserScript==
// @name         Discord Council Bot — Queue
// @namespace    dcbot-queue
// @version      1.0.3
// @description  Add tracks to the Discord Council Bot queue right from YouTube, Yandex Music, SoundCloud and VK pages.
// @author       dcbot
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.yandex.ru/*
// @match        https://soundcloud.com/*
// @match        https://vk.com/*
// @match        https://music.vk.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      *
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

/* The bot serves this file itself: @@SERVER@@ becomes the deployment's base
   URL, so install + updates need zero configuration beyond the API key. */

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

  // --- network -----------------------------------------------------------

  function api(method, path, body) {
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
          let data = {};
          try {
            data = JSON.parse(r.responseText);
          } catch {
            /* non-JSON error body */
          }
          if (r.status >= 200 && r.status < 300) resolve(data);
          else reject(new Error(data.detail || "HTTP " + r.status));
        },
        onerror: () =>
          reject(
            new Error(
              "Бот недоступен: " + getServer() +
              ". Если Tampermonkey спрашивал про доступ к домену — ответьте «разрешить всегда» (меню Tampermonkey → настройки → этому скрипту → домены).",
            ),
          ),
        ontimeout: () => reject(new Error("Таймаут запроса к боту")),
      });
    });
  }

  // --- per-site extractors ------------------------------------------------
  // Each returns { query, source, title, author, length_ms, artwork, stream_url }
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
    const row = {
      query: "https://www.youtube.com/watch?v=" + v,
      source: "yt",
    };
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

  // --- VK: capture stream URLs from the page's own API traffic -----------
  // The VK web player plays blob: URLs, so the only way to get a playable
  // link is to hook the page's fetch/XHR and pick audio items out of the
  // JSON payloads it loads. Items land in vkCaptured (newest last).

  const vkCaptured = [];
  const VK_MAX_ITEMS = 40;

  function vkRemember(item) {
    if (!item.url || !/^https?:\/\//.test(item.url) || /\.m3u8/i.test(item.url)) return;
    if (!item.owner_id && !item.url) return;
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
    if (
      typeof value.url === "string" &&
      /\.mp3(\?|$)/.test(value.url) &&
      (value.title || value.artist) &&
      typeof value.url === "string" &&
      value.url.length < 1200
    ) {
      vkRemember({
        owner_id: value.owner_id ?? null,
        id: value.id ?? null,
        url: value.url.startsWith("//") ? "https:" + value.url : value.url,
        title: (value.title || "").trim(),
        artist: (value.artist || "").trim(),
        duration: Number(value.duration) || 0,
      });
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
    [/^(vk\.com|m\.vk\.com|music\.vk\.com|vkontakte\.ru)$/, extractVK],
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

  // --- UI -----------------------------------------------------------------

  const CSS = `
    #dcbot-pill{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;align-items:center;gap:6px;
      background:#1f1b2e;color:#e7e1f5;border:1px solid #453f63;border-radius:999px;padding:8px 14px;
      font:500 13px/1 Roboto,system-ui,sans-serif;cursor:pointer;user-select:none;box-shadow:0 6px 18px rgba(0,0,0,.45);
      opacity:.82;transition:opacity .15s}
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

  function ensurePill() {
    if (!document.getElementById("dcbot-pill")) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.documentElement.appendChild(style);
      const pill = document.createElement("div");
      pill.id = "dcbot-pill";
      pill.textContent = "＋ Queue";
      pill.title = "Добавить трек в очередь Discord Council Bot";
      pill.addEventListener("click", enqueueCurrent);
      document.documentElement.appendChild(pill);
    }
  }

  function setPill(state) {
    const pill = document.getElementById("dcbot-pill");
    if (!pill) return;
    pill.classList.toggle("busy", state === "busy");
    pill.textContent = state === "busy" ? "…" : "＋ Queue";
  }

  function requireConfig() {
    if (!getKey()) {
      toast("Ключ не задан: меню Tampermonkey → «Discord Queue: настройки»", true);
      return false;
    }
    if (!getGuild()) {
      toast("Гильдия не выбрана: меню Tampermonkey → «Discord Queue: настройки»", true);
      return false;
    }
    return true;
  }

  async function enqueueCurrent() {
    if (!requireConfig()) return;
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
    setPill("busy");
    try {
      const body = {
        query: row.query,
        source: row.source,
        title: row.title,
        author: row.author,
        length_ms: row.length_ms,
        artwork: row.artwork,
        stream_url: row.stream_url,
      };
      const r = await api("POST", "/api/extension/queue/" + getGuild(), body);
      const where = GM_getValue(LS.guildName, "");
      toast((r.preview ? "Плейлист загружен: " : "В очереди: ") + (r.title || "") + (where ? " → " + where : ""));
    } catch (e) {
      toast(String(e.message || e), true);
    } finally {
      setPill("idle");
    }
  }

  // SPA sites navigate without reloads — keep the pill mounted.
  const observer = new MutationObserver(() => ensurePill());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensurePill();

  const host = location.hostname.replace(/^www\./, "");
  if (/^(vk\.com|m\.vk\.com|music\.vk\.com|vkontakte\.ru)$/.test(host)) initVkHook();

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

  GM_registerMenuCommand("Discord Queue: настройки", configure);
  GM_registerMenuCommand("Discord Queue: проверить связь", checkConnection);
})();
