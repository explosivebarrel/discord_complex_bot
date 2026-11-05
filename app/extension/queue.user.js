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
// @match        https://music.vk.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_deleteValue
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
    const m = location.pathname.match(/^\/(album\/\d+\/)?track\/(\d+)/);
    if (!m) return null;
    return { query: location.origin + "/album/" + (m[1] ? m[1].replace(/\/$/, "") : "0") + "/track/" + m[2], source: "ym" };
  }

  function extractSoundCloud() {
    if (location.pathname === "/" || location.pathname.split("/").filter(Boolean).length < 2) return null;
    return { query: location.origin + location.pathname, source: "sc" };
  }

  function extractVK() {
    // Only music pages: the site has hundreds of non-music URLs.
    const path = location.pathname;
    const track = path.match(/audio(-?\d+)_(\d+)/);
    if (track) {
      return {
        query: "https://vk.com/audio" + track[1] + "_" + track[2],
        source: "vk",
        title: document.title.replace(/\s*\|\s*VK.*$/i, "").trim() || undefined,
      };
    }
    // The web player: best effort — grab the currently playing direct URL
    // so the bot needs no VK token at all.
    const player =
      document.querySelector("#audio_global_player audio, .audio_player audio, audio[audio_id]") ||
      (document.querySelector(".AudioPlayer__progress, .audio_page_player") ? document.querySelector("audio") : null);
    const playing = Array.from(document.querySelectorAll("audio")).find(
      (a) => a.src && (a.duration > 0 || !a.paused)
    );
    const audio = player && player.src ? player : playing;
    if (!audio || !audio.src || audio.src.startsWith("blob:")) return null;
    const titleEl =
      document.querySelector(".audio_page_player_title_performer, .AudioPlayer__trackTitle") || null;
    const row = {
      query: location.origin + location.pathname,
      source: "vk",
      stream_url: audio.src,
      title: (titleEl && titleEl.textContent.trim()) || document.title.replace(/\s*\|\s*VK.*$/i, "").trim(),
    };
    if (isFinite(audio.duration) && audio.duration > 0) row.length_ms = Math.round(audio.duration * 1000);
    return row;
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
    toast._t = setTimeout(() => el.classList.remove("show"), 4000);
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
      toast("На этой странице не найден трек или плейлист", true);
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

  // --- menu ---------------------------------------------------------------

  function ask(label, current) {
    // prompt() inside userscripts is fine (no page code involved).
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
