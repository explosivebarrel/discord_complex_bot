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
}

export interface PlayerState {
  guild_id: string;
  guild_name: string | null;
  connected: boolean;
  channel_id: string | null;
  channel_name: string | null;
  volume: number;
  playing: boolean;
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
  default_voice_channel_id: number | null;
  admin_role_ids: number[];
  admins: string[];
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

  enqueue: (guildId: string, body: { query?: string; encoded?: string }) =>
    fetch(`/api/guilds/${guildId}/player/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<{ queued: number; title: string; now_playing: boolean }>(r)),

  simpleAction: (guildId: string, action: "pause" | "resume" | "skip" | "stop") =>
    fetch(`/api/guilds/${guildId}/player/${action}`, { method: "POST" }).then((r) => handle<unknown>(r)),

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

  guildSettings: (guildId: string) =>
    fetch(`/api/admin/guilds/${guildId}/settings`).then((r) => handle<GuildSettings>(r)),

  updateGuildSettings: (guildId: string, defaultVoiceChannelId: number | null) =>
    fetch(`/api/admin/guilds/${guildId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_voice_channel_id: defaultVoiceChannelId }),
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
