export interface Me {
  discord_id: string;
  username: string;
  global_name: string;
  avatar_url: string;
  is_superadmin: boolean;
}

export interface GuildBrief {
  id: string;
  name: string;
  icon: string | null;
  is_admin: boolean;
  is_superadmin?: boolean;
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
}

export interface PlayerState {
  guild_id: string;
  guild_name: string | null;
  connected: boolean;
  channel_id: string | null;
  channel_name: string | null;
  volume: number;
  playing: boolean;
  repeat: "off" | "one" | "all";
  current: TrackInfo | null;
  queue: TrackInfo[];
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
}

export interface GuildSettings {
  guild: { id: string; name: string; member_count?: number };
  default_voice_channel_id: string | null;
  admin_role_ids: number[];
  admins: string[];
  autoplay_enabled: boolean;
  autoplay_query: string;
}

export interface GuildStats {
  totals: { plays_total: number; plays_30d: number; unique_tracks: number };
  top_tracks: { title: string; author: string; source: string; plays: number }[];
  top_requesters: { name: string; plays: number }[];
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

export interface LibraryFile {
  path: string;
  name: string;
  size_mb: number;
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

  search: (guildId: string, q: string, source: string = "yt") =>
    fetch(`/api/guilds/${guildId}/player/search?q=${encodeURIComponent(q)}&source=${source}`).then((r) =>
      handle<TrackInfo[]>(r),
    ),

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
    }).then((r) => handle<{ queued: number; title: string; now_playing: boolean }>(r)),

  simpleAction: (guildId: string, action: "pause" | "resume" | "skip" | "stop") =>
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

  clearQueue: (guildId: string) =>
    fetch(`/api/guilds/${guildId}/player/queue/clear`, { method: "POST" }).then((r) =>
      handle<{ cleared: number }>(r),
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
};
