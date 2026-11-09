import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { IconDelete as Delete } from "../components/icons";
import { api, GuildSettings } from "../api";
import { useGuildSettings, useGuilds, useVoiceChannels, usePostComposer, useMyPlaylists } from "../queries";
import { CardSkeleton } from "../components/Skeletons";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { useFeedback } from "../components/Feedback";

export function AdminPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const settingsQuery = useGuildSettings(gid);
  // Owner-level trust for this guild: the API bakes the super-admin
  // shortcut and the access mock into the flag.
  const brief = useGuilds().data?.find((g) => g.id === gid);
  const isOwner = !!brief?.is_owner;
  // The forms edit a local draft; it re-syncs whenever the query refetches.
  const [draftSettings, setDraftSettings] = useState<GuildSettings | null>(null);
  useEffect(() => {
    setDraftSettings(settingsQuery.data ?? null);
  }, [settingsQuery.data]);
  const settings = draftSettings ?? settingsQuery.data ?? null;
  const error = settingsQuery.error ? (settingsQuery.error as Error).message : null;
  const channelsQuery = useVoiceChannels(gid);
  const channels = channelsQuery.data ?? [];
  const composerQuery = usePostComposer(gid);
  const textChannels = (composerQuery.data?.channels ?? []).filter((ch) => ch.type === "text");
  const [newAdmin, setNewAdmin] = useState("");
  const [autoplay, setAutoplay] = useState<{
    enabled: boolean;
    query: string;
    playlistId: number | null;
  } | null>(null);
  const myPlaylists = useMyPlaylists().data ?? [];
  const [access, setAccess] = useState<{
    stats: string;
    posts: string;
    moderation: string;
    modLog: string;
    voteSkip: boolean;
    npChannel: string;
    volume: string;
    effects: string;
    queueClear: string;
    seek: string;
  } | null>(null);

  const guard = (e: Error) => feedback.show(e.message, "error");

  const refresh = () => void settingsQuery.refetch();

  // Keep local forms in sync with the loaded settings.
  useEffect(() => {
    if (settings) {
      setAutoplay({
        enabled: settings.autoplay_enabled,
        query: settings.autoplay_query,
        playlistId: settings.autoplay_playlist_id,
      });
      setAccess({
        stats: settings.stats_access,
        posts: settings.posts_access,
        moderation: settings.moderation_access,
        modLog: settings.mod_log_channel_id ?? "",
        voteSkip: settings.vote_skip,
        npChannel: settings.np_channel_id ?? "",
        volume: settings.volume_access,
        effects: settings.effects_access,
        queueClear: settings.queue_clear_access,
        seek: settings.seek_access,
      });
    }
  }, [settings]);


  if (loading) {
    return (
      <AppShell me={me} back title="Manage">
        <CardSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title={settings?.guild.name ?? "Manage"}>
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {error}
        </Typography>
      )}
      {settings && (
        <Stack spacing={2} sx={{ maxWidth: 720 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Default voice channel
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                Used when a track is queued from the panel while the bot is not connected.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Select
                  fullWidth
                  size="small"
                  displayEmpty
                  value={settings.default_voice_channel_id ?? ""}
                  onChange={(e) =>
                    setDraftSettings({
                      ...settings,
                      default_voice_channel_id: e.target.value || null,
                    })
                  }
                >
                  <MenuItem value="">
                    <em>Not set</em>
                  </MenuItem>
                  {channels.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      🔊 {c.name}
                    </MenuItem>
                  ))}
                </Select>
                <Button
                  variant="contained"
                  onClick={() =>
                    api
                      .updateGuildSettings(gid, { default_voice_channel_id: settings.default_voice_channel_id })
                      .then((s) => {
                        setDraftSettings(s);
                        feedback.show("Settings saved");
                      })
                      .catch(guard)
                  }
                >
                  Save
                </Button>
              </Stack>
            </CardContent>
          </Card>

          {autoplay && (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  After the queue
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                  When the queue runs dry, the bot keeps the music going: a
                  shuffled track from the playlist, or a radio station that
                  matches the query.
                </Typography>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoplay.enabled}
                        onChange={(e) => setAutoplay({ ...autoplay, enabled: e.target.checked })}
                      />
                    }
                    label="Autoplay"
                  />
                  <Select
                    size="small"
                    value={autoplay.playlistId ? "playlist" : "radio"}
                    onChange={(e) =>
                      setAutoplay({
                        ...autoplay,
                        playlistId: e.target.value === "playlist" ? (myPlaylists[0]?.id ?? null) : null,
                      })
                    }
                  >
                    <MenuItem value="radio">Radio query</MenuItem>
                    <MenuItem value="playlist" disabled={!myPlaylists.length}>
                      My playlist
                    </MenuItem>
                  </Select>
                  {autoplay.playlistId ? (
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label="Autoplay playlist"
                      value={myPlaylists.some((p) => p.id === autoplay.playlistId) ? autoplay.playlistId : ""}
                      onChange={(e) => setAutoplay({ ...autoplay, playlistId: Number(e.target.value) })}
                    >
                      {myPlaylists.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          {p.name} ({p.tracks})
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <TextField
                      fullWidth
                      size="small"
                      placeholder="Station query (lofi, jazz, news…)"
                      value={autoplay.query}
                      onChange={(e) => setAutoplay({ ...autoplay, query: e.target.value })}
                    />
                  )}
                  <Button
                    variant="contained"
                    onClick={() =>
                      api
                        .updateGuildSettings(gid, {
                          autoplay_enabled: autoplay.enabled,
                          autoplay_query: autoplay.query,
                          autoplay_playlist_id: autoplay.playlistId ?? -1,
                        })
                        .then((s) => {
                          setDraftSettings(s);
                          setAutoplay({
                            enabled: s.autoplay_enabled,
                            query: s.autoplay_query,
                            playlistId: s.autoplay_playlist_id,
                          });
                          feedback.show("Autoplay saved");
                        })
                        .catch(guard)
                    }
                  >
                    Save
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          )}

          {access && (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Panel access
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                  Who can open each panel section. Admins: server owner, Discord
                  Manage Server permission, or an id added below.
                  {!isOwner && " Only the server owner can change the access levels."}
                </Typography>
                {/* The form keeps a fixed readable width instead of stretching
                    the selects across the whole card. */}
                <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
                  {(
                    [
                      ["stats", "Stats"],
                      ["posts", "Posts"],
                      ["moderation", "Moderation"],
                    ] as const
                  ).map(([key, label]) => (
                    <Stack key={key} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <Typography variant="body2" sx={{ width: 110, flexShrink: 0 }}>
                        {label}
                      </Typography>
                      <Tooltip title={isOwner ? undefined : "Only the server owner can change this"}>
                        <span style={{ display: "flex", flex: 1, minWidth: 0 }}>
                          <Select
                            fullWidth
                            size="small"
                            disabled={!isOwner}
                            value={access[key]}
                            onChange={(e) => setAccess({ ...access, [key]: e.target.value as string })}
                          >
                            <MenuItem value="admins">Admins only</MenuItem>
                            <MenuItem value="everyone">Everyone</MenuItem>
                            <MenuItem value="off">Off</MenuItem>
                          </Select>
                        </span>
                      </Tooltip>
                    </Stack>
                  ))}
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ width: 110, flexShrink: 0 }}>
                      Now playing
                    </Typography>
                    <Select
                      fullWidth
                      size="small"
                      displayEmpty
                      value={access.npChannel}
                      onChange={(e) => setAccess({ ...access, npChannel: e.target.value as string })}
                    >
                      <MenuItem value="">
                        <em>Not set (announcements off)</em>
                      </MenuItem>
                      {textChannels.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          # {c.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </Stack>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ width: 110, flexShrink: 0 }}>
                      Mod log
                    </Typography>
                    <Tooltip title={isOwner ? undefined : "Only the server owner can change this"}>
                      <span style={{ display: "flex", flex: 1, minWidth: 0 }}>
                        <Select
                          fullWidth
                          size="small"
                          disabled={!isOwner}
                          value={access.modLog}
                          onChange={(e) => setAccess({ ...access, modLog: e.target.value as string })}
                          displayEmpty
                        >
                          <MenuItem value="">
                            <em>Not set</em>
                          </MenuItem>
                          {textChannels.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              # {c.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </span>
                    </Tooltip>
                  </Stack>
                  <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      variant="contained"
                      onClick={() =>
                        api
                          .updateGuildSettings(
                            gid,
                            // Non-owners must not send the privilege fields:
                            // the API rejects the whole update if they do.
                            isOwner
                              ? {
                                  stats_access: access.stats,
                                  posts_access: access.posts,
                                  moderation_access: access.moderation,
                                  mod_log_channel_id: access.modLog || null,
                                  np_channel_id: access.npChannel || null,
                                  clear_np_channel: !access.npChannel,
                                }
                              : {
                                  mod_log_channel_id: access.modLog || null,
                                  np_channel_id: access.npChannel || null,
                                  clear_np_channel: !access.npChannel,
                                },
                          )
                          .then((s) => {
                            setDraftSettings(s);
                            setAccess({
                              stats: s.stats_access,
                              posts: s.posts_access,
                              moderation: s.moderation_access,
                              modLog: s.mod_log_channel_id ?? "",
                              npChannel: s.np_channel_id ?? "",
                              voteSkip: s.vote_skip,
                              volume: s.volume_access,
                              effects: s.effects_access,
                              queueClear: s.queue_clear_access,
                              seek: s.seek_access,
                            });
                            feedback.show("Panel access saved");
                          })
                          .catch(guard)
                      }
                    >
                      Save
                    </Button>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          )}

          {access && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Player
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                Vote-skip makes a skip count only when half the voice channel
                agrees. Action permissions decide who may change the volume,
                switch effects, seek and clear the queue — the server owner
                and the bot's super-admin always can.
                {!isOwner && " Only the server owner can change the access levels."}
              </Typography>
              <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
                <FormControlLabel
                  sx={{ px: 0.5 }}
                  control={
                    <Switch
                      checked={access.voteSkip}
                      onChange={(e) => setAccess({ ...access, voteSkip: e.target.checked })}
                    />
                  }
                  label="Vote-skip (half the voice channel must agree)"
                />
                {(
                  [
                    ["Volume", "volume"],
                    ["Effects", "effects"],
                    ["Clear queue", "queueClear"],
                    ["Seek", "seek"],
                  ] as const
                ).map(([label, key]) => (
                  <Stack key={key} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ width: 110, flexShrink: 0 }}>
                      {label}
                    </Typography>
                    <Tooltip title={isOwner ? undefined : "Only the server owner can change this"}>
                      <span style={{ display: "flex", flex: 1, minWidth: 0 }}>
                        <Select
                          fullWidth
                          size="small"
                          disabled={!isOwner}
                          value={access[key]}
                          onChange={(e) => setAccess({ ...access, [key]: e.target.value as string })}
                        >
                          <MenuItem value="members">Everyone</MenuItem>
                          <MenuItem value="admins">Admins only</MenuItem>
                          <MenuItem value="off">Owner only</MenuItem>
                        </Select>
                      </span>
                    </Tooltip>
                  </Stack>
                ))}
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    variant="contained"
                    disabled={!isOwner}
                    onClick={() =>
                      api
                        .updateGuildSettings(gid, {
                          vote_skip: access.voteSkip,
                          volume_access: access.volume,
                          effects_access: access.effects,
                          queue_clear_access: access.queueClear,
                          seek_access: access.seek,
                        })
                        .then((s) => {
                          setDraftSettings(s);
                          setAccess({
                            ...access,
                            voteSkip: s.vote_skip,
                            volume: s.volume_access,
                            effects: s.effects_access,
                            queueClear: s.queue_clear_access,
                            seek: s.seek_access,
                          });
                          feedback.show("Player settings saved");
                        })
                        .catch(guard)
                    }
                  >
                    Save
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Server admins (web panel)
              </Typography>
              {!isOwner && (
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
                  Only the server owner can manage panel admins.
                </Typography>
              )}
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Discord user ID"
                  value={newAdmin}
                  disabled={!isOwner}
                  onChange={(e) => setNewAdmin(e.target.value)}
                />
                <Button
                  variant="tonal"
                  disabled={!isOwner || !newAdmin.trim()}
                  onClick={() =>
                    api
                      .addGuildAdmin(gid, newAdmin)
                      .then(() => {
                        refresh();
                        setNewAdmin("");
                        feedback.show("Admin added");
                      })
                      .catch(guard)
                  }
                >
                  Add
                </Button>
              </Stack>
              {settings.admins.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  No extra admins yet.
                </Typography>
              ) : (
                <List disablePadding>
                  {settings.admins.map((a) => (
                    <ListItem
                      key={a}
                      disableGutters
                      secondaryAction={
                        <Tooltip title={isOwner ? "Remove admin" : "Only the server owner can manage panel admins"}>
                          <span>
                            <IconButton
                              edge="end"
                              disabled={!isOwner}
                              onClick={() =>
                                api
                                  .removeGuildAdmin(gid, a)
                                  .then(() => refresh())
                                  .catch(guard)
                              }
                            >
                              <Delete />
                            </IconButton>
                          </span>
                        </Tooltip>
                      }
                    >
                      <ListItemText primary={a} />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}
      {feedback.node}
    </AppShell>
  );
}
