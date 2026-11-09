/**
 * Project versioning: vX.YY.ZZ — X for logic-changing redesigns, YY for
 * large feature blocks, ZZ for daily fixes. The current version is the
 * last entry of CHANGELOG; bump it with every release commit.
 */
export const BOT_VERSION = "v3.04.00";

export interface ChangelogBlock {
  version: string;
  /** ISO date of the block's last commit. */
  date: string;
  /** The commit the version lands on (the block's last commit). */
  commit: string;
  title: string;
  points: string[];
}

export const CHANGELOG: ChangelogBlock[] = [
  {
    version: "v3.04.00",
    date: "2026-11-09",
    title: "Player QoL batch: sleep timer, voice rejoin, vote-skip, lyrics, effects, permissions",
    points: [
      "Sleep timer: fade-out and pause after 15/30/45/60 minutes or at the end of the track (dock menu, /sleep)",
      "The bot rejoins its voice channels and resumes the queues after a restart - deploys no longer drop playback",
      "Vote-skip (per-guild toggle in Manage): a skip fires when half the voice channel agrees",
      "Synced lyrics on the now-playing screen via LRCLIB (cached), click a line to seek",
      "Play next (context menus), save the queue as a personal playlist, keyboard shortcuts (Space / arrows / M)",
      "Sound effects menu in the dock: nightcore, slowed, chipmunk, deep, bass boost, underwater, 8D, robot, karaoke, x1.5 speed",
      "Now-playing announcements to a configurable text channel with pause/skip buttons; /nowplaying renders the same embed",
      "Import external playlists (Yandex Music, YouTube...) into personal playlists from the playlist view",
      "Player action permissions in Manage: volume / effects / clear queue / seek - admins, members or owner only",
      "Fixed the icon subset rebuild pipeline (ligatures were dropped, icons rendered as raw text)",
    ],
  },
  {
    version: "v3.03.10",
    commit: "ab3c6f1",
    date: "2026-11-06",
    title: "VK browser sidecar and infrastructure",
    points: [
      "Aurora mesh: god rays from blob centers - per-blob scheduled events, transparent core, dusty fading rays; mesh-only settings (glow / length / frequency)",
    ],
  },
  {
    version: "v3.03.09",
    commit: "fe12fb5",
    date: "2026-11-06",
    title: "VK browser sidecar and infrastructure",
    points: [
      "vkresolver: a logged-in headless browser resolves VK tracks the page cannot capture (signed CDN URLs, covers, anti-ban pacing with an hourly ceiling and negative caching)",
      "The frontend moved to its own nginx container (dcbot-web) with dynamic app resolution — backend rebuilds no longer break the panel",
      "VK fallback re-routed through yt-dlp after Lavalink's YouTube clients were login-walled from the server IP",
      "Fast no-access detection (~4s instead of 30-60s), clear 'Track skipped' notifications with the reason",
      "Track artwork now arrives from the sidecar / yt-dlp when the queue item has none",
      "Fixes: notification popover in the collapsed rail, FAB frost via CSS backdrop-filter (no more ghost ring on the dock), blur slider minimum 1px, negative owner ids in VK track URLs",
    ],
  },
  {
    version: "v3.02.00",
    commit: "ec31ac9",
    date: "2026-11-05",
    title: "VK Music and the userscript plugin",
    points: [
      "VK Music source: token validation on save, official-client direct auth (login/password + 2FA), serialized audio API calls to reduce antifraud risk, performer search",
      "Userscript plugin v1.0.0 - v1.1.18: personal API keys, /api/extension/queue, hover panel with page tracks per site, VK stream capture (fetch/XHR hooks, DOM scraping, play-to-capture), session log with diagnostics",
      "Extension page with the English install guide and key management",
    ],
  },
  {
    version: "v3.01.00",
    commit: "f231860",
    date: "2026-11-05",
    title: "Liquid Glass v2: a two-pass WebGL scene",
    points: [
      "One scene, two passes: procedural backdrop into a texture, then panels, lenses and the seek line composited over it",
      "Continuous panel frost via the mip pyramid, lens-over-lens z-order, warm-up pill, tint/blur/aberration tuning",
      "Aurora mesh backdrop on WebGL",
    ],
  },
  {
    version: "v3.00.00",
    commit: "f4aaf9b",
    date: "2026-11-04",
    title: "Player redesign v2: tabs, artwork, live panel",
    points: [
      "Player tabs: home / collection / history; now-playing screen; URL routes for nested views",
      "Track artwork cache everywhere a track shows; playlist cover mosaics",
      "Live panel: player-state websocket, notification bell, account menu",
      "Statistics v2: listening minutes, per-source/artist/activity charts",
      "Search cache with stale-while-revalidate; playback resync after Lavalink reconnects",
    ],
  },
  {
    version: "v2.02.00",
    commit: "55aa881",
    date: "2026-10-31",
    title: "Availability monitoring",
    points: [
      "About page with availability strips (hour/day/month), status chip deep-link, color-blind palette",
      "Auto-gating the Lavalink YouTube plugin on reachability; retry when Discord is unreachable",
      "Radio-browser search over every mirror",
    ],
  },
  {
    version: "v2.01.00",
    commit: "e922da5",
    date: "2026-10-18",
    title: "Themes and the first Liquid Glass",
    points: [
      "5 base palettes plus aurora and liquid-glass animated themes with tuning",
      "WebGL dock lens, glass tonal pills, live glass tuning dialog, superadmin effect sandbox",
      "Panel audio uploads for guild members",
    ],
  },
  {
    version: "v2.00.00",
    commit: "dd3bb1d",
    date: "2026-10-17",
    title: "MD3 shell redesign (player and navigation)",
    points: [
      "Reworked to an MD3 shell: nav drawer, queue sidebar, player bar, inset-surface frame",
      "TanStack Query data layer, skeletons, responsive player side sheet, mobile layout pass",
      "Material Symbols Rounded everywhere, unified type scale, permissions single source of truth",
    ],
  },
  {
    version: "v1.03.00",
    commit: "8e89d44",
    date: "2026-10-09",
    title: "Playlists and persistence",
    points: [
      "Playlist browser with lazy full-playlist playback and page splicing; Yandex playlist limit raised to 1000",
      "Personal playlists stored per user; queue/history/repeat persisted across restarts",
      "Queue drag and drop, jump, shuffle, previous, re-queue from history; moderation restricted to the owner",
    ],
  },
  {
    version: "v1.02.00",
    commit: "dd40655",
    date: "2026-10-07",
    title: "Feature core",
    points: [
      "Queue management, repeat modes, play history, favorites, playback statistics",
      "Autoplay radio station, post and thread publishing, local music library",
      "Lazy playlist queueing",
    ],
  },
  {
    version: "v1.01.00",
    commit: "4983bbf",
    date: "2026-10-07",
    title: "Sources and the first MD3 redesign",
    points: [
      "Radio stations, Archive.org audio, SoundCloud, Yandex Music via LavaSrc",
      "YouTube through yt-dlp; the first Material Design 3 panel pass",
    ],
  },
  {
    version: "v1.00.00",
    commit: "ef12d1d",
    date: "2026-10-06",
    title: "Core skeleton",
    points: [
      "discord.py bot + Lavalink music, FastAPI web panel with Discord OAuth2, React SPA, Docker",
      "Auth, snowflake and playback fixes; system settings page; live streams",
    ],
  },
];
