export interface Me {
  discord_id: string;
  username: string;
  global_name: string;
  avatar_url: string;
  is_superadmin: boolean;
}

export interface GuildBrief {
  id: number;
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
}

export interface PlayerState {
  guild_id: number;
  guild_name: string | null;
  connected: boolean;
  channel_id: number | null;
  channel_name: string | null;
  volume: number;
  playing: boolean;
  current: TrackInfo | null;
  queue: TrackInfo[];
}

export interface VoiceChannel {
  id: number;
  name: string;
  user_limit: number;
}

export interface GuildSettings {
  guild: { id: number; name: string; member_count?: number };
  default_voice_channel_id: number | null;
  admin_role_ids: number[];
  admins: number[];
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

  playerState: (guildId: number) =>
    fetch(`/api/guilds/${guildId}/player/state`).then((r) => handle<PlayerState>(r)),

  voiceChannels: (guildId: number) =>
    fetch(`/api/guilds/${guildId}/player/channels`).then((r) => handle<VoiceChannel[]>(r)),

  join: (guildId: number, channelId: number) =>
    fetch(`/api/guilds/${guildId}/player/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_id: channelId }),
    }).then((r) => handle<{ connected: boolean }>(r)),

  leave: (guildId: number) =>
    fetch(`/api/guilds/${guildId}/player/leave`, { method: "POST" }).then((r) => handle<unknown>(r)),

  search: (guildId: number, q: string) =>
    fetch(`/api/guilds/${guildId}/player/search?q=${encodeURIComponent(q)}`).then((r) =>
      handle<TrackInfo[]>(r),
    ),

  enqueue: (guildId: number, query: string) =>
    fetch(`/api/guilds/${guildId}/player/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }).then((r) => handle<{ queued: number; title: string; now_playing: boolean }>(r)),

  simpleAction: (guildId: number, action: "pause" | "resume" | "skip" | "stop") =>
    fetch(`/api/guilds/${guildId}/player/${action}`, { method: "POST" }).then((r) => handle<unknown>(r)),

  volume: (guildId: number, volume: number) =>
    fetch(`/api/guilds/${guildId}/player/volume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volume }),
    }).then((r) => handle<{ volume: number }>(r)),

  seek: (guildId: number, position: number) =>
    fetch(`/api/guilds/${guildId}/player/seek`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    }).then((r) => handle<unknown>(r)),

  guildSettings: (guildId: number) =>
    fetch(`/api/admin/guilds/${guildId}/settings`).then((r) => handle<GuildSettings>(r)),

  updateGuildSettings: (guildId: number, defaultVoiceChannelId: number | null) =>
    fetch(`/api/admin/guilds/${guildId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ default_voice_channel_id: defaultVoiceChannelId }),
    }).then((r) => handle<GuildSettings>(r)),

  addGuildAdmin: (guildId: number, discordId: string) =>
    fetch(`/api/admin/guilds/${guildId}/admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discord_id: Number(discordId) }),
    }).then((r) => handle<{ admins: number[] }>(r)),

  removeGuildAdmin: (guildId: number, discordId: number) =>
    fetch(`/api/admin/guilds/${guildId}/admins/${discordId}`, { method: "DELETE" }).then((r) =>
      handle<{ admins: number[] }>(r),
    ),

  allBotGuilds: () => fetch("/api/admin/guilds").then((r) => handle<GuildBrief[]>(r)),
};
