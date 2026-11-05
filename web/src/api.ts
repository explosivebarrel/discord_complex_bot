export type AccessMockTier = "owner" | "admin" | "member" | "guest";

export interface Me {
  discord_id: string;
  username: string;
  global_name: string;
  avatar_url: string;
  is_superadmin: boolean;
  /** Super-admin testing override: guild id -> pretended tier. */
  access_mock?: Record<string, AccessMockTier>;
}

export type GuildSection = keyof GuildBrief["access"];

export interface GuildBrief {
  id: string;
  name: string;
  icon: string | null;
  is_admin: boolean;
  /** Owner-level trust: section access matrix and the panel admin list. */
  is_owner?: boolean;
  is_superadmin?: boolean;
  access: {
    player: boolean;
    manage: boolean;
    stats: boolean;
    posts: boolean;
    moderation: boolean;
  };
  /** Which sections the BOT can perform on this server. Missing on stale
      cached payloads; a false here is the reason access is false. */
  bot_access?: Partial<Record<GuildSection, boolean>>;
}

/** Single source of truth for section availability, shared by the home
    cards and the sidebar so the two can never disagree. The API already
    bakes the super-admin shortcut and any access mock into the flags. */
export function guildAllows(guild: GuildBrief, section: GuildSection): boolean {
  return !!guild.access?.[section];
}

/** Tooltip for a disabled section: user rights vs the bot's permissions. */
export function guildSectionHint(guild: GuildBrief, section: GuildSection): string {
  if (guildAllows(guild, section)) return "";
  return guild.bot_access?.[section] === false
    ? "The bot is missing Discord permissions on this server"
    : "You don't have access to this section";
}

export interface ModerationWarning {
  id: number;
  user_id: string;
  user_name: string;
  issuer_id: string | null;
  issuer_name: string;
  reason: string;
  created_at: string;
}

export interface ModerationAction {
  action: string;
  actor_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/** Search endpoint reply with the stale-while-revalidate verdict: "fresh"
    results came from a ≤30-min cache (instant), "stale" from an older
    cached query (a forced re-search follows), "miss" from a live search. */
export interface NotificationInfo {
  id: number | null;
  guild_id: number | null;
  category: "player" | "availability";
  title: string;
  body: string;
  created_at: string | null;
}

export interface SearchResponse {
  results: TrackInfo[];
  cache: "fresh" | "stale" | "miss";
}

export interface TrackInfo {
  title: string;
  author: string | null;
  uri: string | null;
  length: number;
  artwork: string | null;
  source: string | null;
  requested_by: string;
  position?: number;
  paused?: boolean;
  encoded?: string;
  /** "hls" or "drm" when the All-search probe found a playback limit. */
  issue?: string | null;
  /** True while the next track is resolving its stream (transition). */
  loading?: boolean;
  /** Set on the lazy playlist row: open the browser for this playlist. */
  playlist_id?: number;
  /** Local library rows: the library-relative path and file facts. */
  path?: string;
  size_mb?: number;
  uploader?: string;
}

/** A file uploaded to the guild's library folder. */
export interface GuildUpload {
  path: string;
  name: string;
  size_mb: number;
  uploader: string;
}

export interface PlayerState {
  guild_id: string;
  guild_name: string | null;
  connected: boolean;
  channel_id: string | null;
  channel_name: string | null;
  /** Guild setting: the channel the panel preselects while not connected. */
  default_voice_channel_id?: string | null;
  volume: number;
  playing: boolean;
  repeat: "off" | "one" | "all";
  current: TrackInfo | null;
  queue: TrackInfo[];
  /** Session history, newest first. */
  played: TrackInfo[];
}

export interface PlaylistTrack {
  index: number;
  title: string;
  author: string;
  length: number;
  artwork: string | null;
  uri: string | null;
}

export interface PlaylistPageInfo {
  id: number;
  title: string;
  source: string;
  total: number;
  matched: number;
  page: number;
  pages: number;
  tracks: PlaylistTrack[];
}

export interface UserPlaylistBrief {
  id: number;
  name: string;
  tracks: number;
  artwork?: string | null;
  /** Up to 4 first track artworks: the card mosaic. */
  artworks?: string[];
  created_at: string;
}

export interface UserPlaylistTrack {
  id: number;
  position: number;
  title: string;
  author: string;
  uri: string;
  source: string;
  length_ms: number;
  artwork: string | null;
}

export interface UserPlaylistFull {
  id: number;
  name: string;
  tracks: UserPlaylistTrack[];
}

export interface VoiceChannel {
  id: string;
  name: string;
  user_limit: number;
}

export interface Integrations {
  discord: { ready: boolean; user: string | null; guilds: number };
  lavalink: { host: string; connected: boolean; players: number };
  youtube: {
    reachable: boolean;
    oauth_configured?: boolean;
    refresh_token_masked?: string | null;
    error?: string;
    token_saved_in_db?: boolean;
    pot_saved_in_db?: boolean;
    last_error?: { message: string; context: Record<string, unknown>; at: string } | null;
  };
  yandexmusic: {
    configured: boolean;
    token_masked?: string | null;
    token_saved_in_db?: boolean;
  };
  vkmusic: {
    configured: boolean;
    token_masked?: string | null;
    token_saved_in_db?: boolean;
  };
}

/** Which search sources can do their job right now. Keys are the panel's
    source ids; a false entry disables the tab until the next poll. */
export interface SourceAvailability {
  [key: string]: boolean | string | null;
  all: boolean;
  yt: boolean;
  sc: boolean;
  ym: boolean;
  vk: boolean;
  radio: boolean;
  archive: boolean;
  local: boolean;
  checked_at: string | null;
}

/** Latest probe pass of the availability monitor. Statuses per service:
    2 = up, 1 = degraded (slow or recently failing), 0 = down, null = n/a. */
export interface SystemStatus {
  ts: string | null;
  bot_ready: boolean;
  statuses: Record<string, number | null>;
}

/** Uptime buckets for one range (hour | day | month). Each value is
    [epoch_seconds, up, degraded, down, na]; a bucket with 0 real samples
    is a gap (the whole app was unreachable). */
export interface AvailabilitySeries {
  bucket_seconds: number;
  values: [number, number, number, number, number][];
}

export interface AvailabilityResponse {
  range: string;
  from: number;
  to: number;
  series: Record<string, AvailabilitySeries>;
  overall: { bucket_seconds: number; values: [number, number | null][] };
  per_service: Record<string, {
    up_pct: number | null;
    degraded_pct: number | null;
    down_pct: number | null;
  }>;
}

export interface GuildSettings {
  guild: { id: string; name: string; member_count?: number };
  default_voice_channel_id: string | null;
  admin_role_ids: number[];
  admins: string[];
  autoplay_enabled: boolean;
  autoplay_query: string;
  autoplay_playlist_id: number | null;
  stats_access: string;
  posts_access: string;
  moderation_access: string;
  mod_log_channel_id: string | null;
}

export interface GuildStats {
  totals: {
    plays_total: number;
    plays_30d: number;
    unique_tracks: number;
    minutes_30d: number;
    minutes_total: number;
  };
  top_tracks: { title: string; author: string; source: string; plays: number }[];
  top_requesters: { name: string; plays: number }[];
  by_source: { source: string; plays: number }[];
  top_authors: { author: string; plays: number }[];
  by_day: { day: string; plays: number }[];
  recent: { title: string; author: string; source: string; requested_by: string; played_at: string }[];
}

export interface FavoriteTrackInfo {
  id: number;
  title: string;
  author: string;
  uri: string;
  source: string;
  length_ms: number;
  artwork: string | null;
  added_at: string;
}

export interface PostChannel {
  id: string;
  name: string;
  type: "text" | "forum";
}

export interface ComposerData {
  channels: PostChannel[];
  roles: { id: string; name: string; color: string | null; mentionable: boolean }[];
  users: { id: string; name: string; avatar: string | null }[];
  emojis: { name: string; id: string; animated: boolean }[];
}

async function handle<T>(resp: Response): Promise<T> {
  if (resp.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(body.detail ?? `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  me: () => fetch("/api/auth/me").then((r) => handle<Me>(r)),

  logout: () => fetch("/api/auth/logout", { method: "POST" }),

  myGuilds: () => fetch("/api/auth/guilds").then((r) => handle<GuildBrief[]>(r)),

  setAccessMock: (guildId: string, tier: AccessMockTier | null) =>
    fetch("/api/auth/access-mock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guild_id: guildId, tier }),
    }).then((r) => handle<{ status: string }>(r)),

  playerState: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/state`).then((r) => handle<PlayerState>(r)),

  voiceChannels: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/channels`).then((r) => handle<VoiceChannel[]>(r)),

  join: (guildId: string, channelId: string) =>
    fetch(`/api/guilds/${guildId}/player/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId }),
    }).then((r) => handle<{ connected: boolean }>(r)),

  leave: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/leave`, { method: "POST" }).then((r) => handle<unknown>(r)),

  notifications: () => fetch("/api/notifications?limit=40").then((r) => handle<NotificationInfo[]>(r)),

  playlistPreview: (guildId: string, query: string, source = "all") =>
    fetch(`/api/guilds/${guildId}/player/playlist/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, source }),
    }).then((r) => handle<PlaylistPageInfo>(r)),

  search: (guildId: string, q: string, source: string = "yt", fresh = false, performer = false) =>
    fetch(
      `/api/guilds/${guildId}/player/search?q=${encodeURIComponent(q)}&source=${source}${fresh ? "&fresh=true" : ""}${performer ? "&performer=true" : ""}`,
    ).then((r) => handle<SearchResponse>(r)),

  uploadTrack: (guildId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch(`/api/guilds/${guildId}/player/uploads`, { method: "POST", body }).then((r) =>
      handle<GuildUpload>(r),
    );
  },

  guildUploads: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/uploads`).then((r) => handle<GuildUpload[]>(r)),

  deleteUpload: (guildId: string, path: string) =>
    fetch(`/api/guilds/${guildId}/player/uploads/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: "DELETE",
    }).then((r) => handle<{ deleted: string }>(r)),

  enqueue: (
    guildId: string,
    body: {
      query?: string;
      encoded?: string;
      source?: string;
      title?: string;
      author?: string;
      length_ms?: number;
      artwork?: string | null;
    },
  ) =>
    fetch(`/api/guilds/${guildId}/player/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) =>
      handle<{ queued: number; title: string; now_playing: boolean; preview?: PlaylistPageInfo }>(r),
    ),

  simpleAction: (guildId: string, action: "pause" | "resume" | "skip" | "stop" | "previous") =>
    fetch(`/api/guilds/${guildId}/player/${action}`, { method: "POST" }).then((r) => handle<unknown>(r)),

  repeat: (guildId: string, mode: "off" | "one" | "all") =>
    fetch(`/api/guilds/${guildId}/player/repeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }).then((r) => handle<{ repeat: "off" | "one" | "all" }>(r)),

  favorites: () => fetch("/api/favorites").then((r) => handle<FavoriteTrackInfo[]>(r)),

  addFavorite: (body: {
    title: string;
    author?: string;
    uri: string;
    source?: string;
    length_ms?: number;
    artwork?: string | null;
  }) =>
    fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ id: number }>(r)),

  postComposer: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/posts/composer`).then((r) => handle<ComposerData>(r)),

  createPost: (guildId: string, body: { channel_id: string; text: string; title?: string }) =>
    fetch(`/api/guilds/${guildId}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ result: string }>(r)),

  removeFavorite: (id: number) =>
    fetch(`/api/favorites/${id}`, { method: "DELETE" }).then((r) => handle<{ removed: boolean }>(r)),

  moderationUsers: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/moderation/users`).then((r) =>
      handle<{ id: string; name: string; avatar: string | null }[]>(r),
    ),

  moderationWarnings: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/moderation/warnings`).then((r) => handle<ModerationWarning[]>(r)),

  moderationLog: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/moderation/log`).then((r) => handle<ModerationAction[]>(r)),

  moderationAction: (
    guildId: string,
    kind: "timeout" | "kick" | "ban",
    body: { user_id: string; reason?: string; minutes?: number; delete_days?: number },
  ) =>
    fetch(`/api/guilds/${guildId}/moderation/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<Record<string, string>>(r)),

  clearQueue: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/queue/clear`, { method: "POST" }).then((r) =>
      handle<{ cleared: number }>(r),
    ),

  expandQueuedPlaylist: (guildId: string, index: number) =>
    fetch(`/api/guilds/${guildId}/player/queue/${index}/expand`, { method: "POST" }).then((r) =>
      handle<{ expanded: number; remaining: number; total: number }>(r),
    ),

  removeQueued: (guildId: string, index: number) =>
    fetch(`/api/guilds/${guildId}/player/queue/${index}`, { method: "DELETE" }).then((r) =>
      handle<{ removed: string }>(r),
    ),

  moveQueued: (guildId: string, from: number, to: number) =>
    fetch(`/api/guilds/${guildId}/player/queue/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }).then((r) => handle<{ moved: string }>(r)),

  shuffleQueue: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/queue/shuffle`, { method: "POST" }).then((r) =>
      handle<{ shuffled: number }>(r),
    ),

  jumpQueued: (guildId: string, index: number) =>
    fetch(`/api/guilds/${guildId}/player/queue/jump`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    }).then((r) => handle<{ jumped: string }>(r)),

  replayPlayed: (guildId: string, position: number) =>
    fetch(`/api/guilds/${guildId}/player/played/replay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    }).then((r) => handle<{ playing: string }>(r)),

  requeuePlayed: (guildId: string, position: number) =>
    fetch(`/api/guilds/${guildId}/player/played/requeue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    }).then((r) => handle<{ queued: string }>(r)),

  playlistPage: (guildId: string, playlistId: number, page: number, q: string) =>
    fetch(
      `/api/guilds/${guildId}/player/playlist/${playlistId}?page=${page}&q=${encodeURIComponent(q)}`,
    ).then((r) => handle<PlaylistPageInfo>(r)),

  playlistAdd: (guildId: string, playlistId: number, indices: number[]) =>
    fetch(`/api/guilds/${guildId}/player/playlist/${playlistId}/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indices }),
    }).then((r) => handle<{ added: number }>(r)),

  playlistAddAll: (guildId: string, playlistId: number) =>
    fetch(`/api/guilds/${guildId}/player/playlist/${playlistId}/add_all`, { method: "POST" }).then(
      (r) => handle<{ queued: number; remaining: number; total: number }>(r),
    ),

  playlistPlay: (guildId: string, playlistId: number, index: number) =>
    fetch(`/api/guilds/${guildId}/player/playlist/${playlistId}/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    }).then((r) => handle<{ playing: string }>(r)),

  myPlaylists: () => fetch("/api/playlists").then((r) => handle<UserPlaylistBrief[]>(r)),

  createUserPlaylist: (name: string) =>
    fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => handle<{ id: number }>(r)),

  deleteUserPlaylist: (playlistId: number) =>
    fetch(`/api/playlists/${playlistId}`, { method: "DELETE" }).then((r) =>
      handle<{ removed: boolean }>(r),
    ),

  userPlaylist: (playlistId: number) =>
    fetch(`/api/playlists/${playlistId}`).then((r) => handle<UserPlaylistFull>(r)),

  addUserPlaylistTracks: (
    playlistId: number,
    tracks: { title?: string; author?: string; uri: string; source?: string; length_ms?: number; artwork?: string | null }[],
  ) =>
    fetch(`/api/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks }),
    }).then((r) => handle<{ added: number; skipped: number }>(r)),

  removeUserPlaylistTrack: (playlistId: number, trackId: number) =>
    fetch(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" }).then((r) =>
      handle<{ removed: boolean }>(r),
    ),

  playUserPlaylistTrack: (guildId: string, playlistId: number, index: number) =>
    fetch(`/api/guilds/${guildId}/player/myplaylist/${playlistId}/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index }),
    }).then((r) => handle<{ playing: string }>(r)),

  queueFavorites: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/favorites/queue`, { method: "POST" }).then(
      (r) => handle<{ queued: number }>(r),
    ),

  queueUserPlaylist: (guildId: string, playlistId: number, shuffle = false) =>
    fetch(`/api/guilds/${guildId}/player/myplaylist/${playlistId}/queue${shuffle ? "?shuffle=true" : ""}`, {
      method: "POST",
    }).then((r) => handle<{ queued: number }>(r)),

  queueUserPlaylistTrack: (guildId: string, playlistId: number, index: number) =>
    fetch(`/api/guilds/${guildId}/player/myplaylist/${playlistId}/queue/${index}`, {
      method: "POST",
    }).then((r) => handle<{ queued: number }>(r)),

  volume: (guildId: string, volume: number) =>
    fetch(`/api/guilds/${guildId}/player/volume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volume }),
    }).then((r) => handle<{ volume: number }>(r)),

  seek: (guildId: string, position: number) =>
    fetch(`/api/guilds/${guildId}/player/seek`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    }).then((r) => handle<unknown>(r)),

  guildStats: (guildId: string) =>
    fetch(`/api/admin/guilds/${guildId}/stats`).then((r) => handle<GuildStats>(r)),

  guildSettings: (guildId: string) =>
    fetch(`/api/admin/guilds/${guildId}/settings`).then((r) => handle<GuildSettings>(r)),

  updateGuildSettings: (
    guildId: string,
    body: {
      default_voice_channel_id?: string | null;
      autoplay_enabled?: boolean;
      autoplay_query?: string;
      autoplay_playlist_id?: number | null;
      stats_access?: string;
      posts_access?: string;
      moderation_access?: string;
      mod_log_channel_id?: string | null;
    },
  ) =>
    fetch(`/api/admin/guilds/${guildId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<GuildSettings>(r)),

  addGuildAdmin: (guildId: string, discordId: string) =>
    fetch(`/api/admin/guilds/${guildId}/admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discord_id: discordId }),
    }).then((r) => handle<{ admins: string[] }>(r)),

  removeGuildAdmin: (guildId: string, discordId: string) =>
    fetch(`/api/admin/guilds/${guildId}/admins/${discordId}`, { method: "DELETE" }).then((r) =>
      handle<{ admins: string[] }>(r),
    ),

  allBotGuilds: () => fetch("/api/admin/guilds").then((r) => handle<GuildBrief[]>(r)),

  integrations: () => fetch("/api/admin/system/integrations").then((r) => handle<Integrations>(r)),

  /** Panel-wide source availability, refreshed by the backend every 5 min. */
  sources: () => fetch("/api/system/sources").then((r) => handle<SourceAvailability>(r)),

  /** Latest availability probe pass (shell status chip). */
  systemStatus: () => fetch("/api/system/status").then((r) => handle<SystemStatus>(r)),

  /** Uptime buckets for the About page. range: hour | day | month. */
  availability: (range: string) =>
    fetch(`/api/system/availability?range=${encodeURIComponent(range)}`).then((r) => handle<AvailabilityResponse>(r)),

  updateYoutubeConfig: (body: { refresh_token?: string; po_token?: string; visitor_data?: string }) =>
    fetch("/api/admin/system/youtube", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ oauth_configured: boolean; refresh_token_masked: string; pot_saved: boolean }>(r)),

  clearYoutubePot: () =>
    fetch("/api/admin/system/youtube/pot", { method: "DELETE" }).then((r) => handle<{ cleared: boolean }>(r)),

  clearYoutubeLastError: () =>
    fetch("/api/admin/system/youtube/last-error", { method: "DELETE" }).then((r) => handle<{ cleared: boolean }>(r)),

  updateYandexToken: (accessToken: string) =>
    fetch("/api/admin/system/yandexmusic", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken }),
    }).then((r) =>
      handle<{ token_masked: string; env_updated: boolean; note: string }>(r),
    ),

  updateVkToken: (accessToken: string) =>
    fetch("/api/admin/system/vkmusic", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken }),
    }).then((r) =>
      handle<{ token_masked: string; env_updated: boolean; note: string }>(r),
    ),
};
