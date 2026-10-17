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
import Delete from "@mui/icons-material/Delete";
import { api, GuildSettings } from "../api";
import { useGuildSettings, useVoiceChannels, usePostComposer } from "../queries";
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
  const [autoplay, setAutoplay] = useState<{ enabled: boolean; query: string } | null>(null);
  const [access, setAccess] = useState<{
    stats: string;
    posts: string;
    moderation: string;
    modLog: string;
  } | null>(null);

  const guard = (e: Error) => feedback.show(e.message, "error");

  const refresh = () => void settingsQuery.refetch();

  // Keep local forms in sync with the loaded settings.
  useEffect(() => {
    if (settings) {
      setAutoplay({ enabled: settings.autoplay_enabled, query: settings.autoplay_query });
      setAccess({
        stats: settings.stats_access,
        posts: settings.posts_access,
        moderation: settings.moderation_access,
        modLog: settings.mod_log_channel_id ?? "",
      });
    }
  }, [settings]);

  // Keep the local autoplay form in sync with the loaded settings.
  useEffect(() => {
    if (settings) setAutoplay({ enabled: settings.autoplay_enabled, query: settings.autoplay_query });
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
                  When the queue runs dry, the bot starts a radio station that
                  matches this query (for example lofi or jazz).
                </Typography>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoplay.enabled}
                        onChange={(e) => setAutoplay({ ...autoplay, enabled: e.target.checked })}
                      />
                    }
                    label="Autoplay"
                  />
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Station query (lofi, jazz, news…)"
                    value={autoplay.query}
                    onChange={(e) => setAutoplay({ ...autoplay, query: e.target.value })}
                  />
                  <Button
                    variant="contained"
                    onClick={() =>
                      api
                        .updateGuildSettings(gid, {
                          autoplay_enabled: autoplay.enabled,
                          autoplay_query: autoplay.query,
                        })
                        .then((s) => {
                          setDraftSettings(s);
                          setAutoplay({ enabled: s.autoplay_enabled, query: s.autoplay_query });
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
                </Typography>
                <Stack spacing={1.5}>
                  {(
                    [
                      ["stats", "Stats"],
                      ["posts", "Posts"],
                      ["moderation", "Moderation"],
                    ] as const
                  ).map(([key, label]) => (
                    <Stack key={key} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <Typography variant="body2" sx={{ width: 110 }}>
                        {label}
                      </Typography>
                      <Select
                        fullWidth
                        size="small"
                        value={access[key]}
                        onChange={(e) => setAccess({ ...access, [key]: e.target.value as string })}
                      >
                        <MenuItem value="admins">Admins only</MenuItem>
                        <MenuItem value="everyone">Everyone</MenuItem>
                        <MenuItem value="off">Off</MenuItem>
                      </Select>
                    </Stack>
                  ))}
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ width: 110 }}>
                      Mod log
                    </Typography>
                    <Select
                      fullWidth
                      size="small"
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
                  </Stack>
                  <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      variant="contained"
                      onClick={() =>
                        api
                          .updateGuildSettings(gid, {
                            stats_access: access.stats,
                            posts_access: access.posts,
                            moderation_access: access.moderation,
                            mod_log_channel_id: access.modLog || null,
                          })
                          .then((s) => {
                            setDraftSettings(s);
                            setAccess({
                              stats: s.stats_access,
                              posts: s.posts_access,
                              moderation: s.moderation_access,
                              modLog: s.mod_log_channel_id ?? "",
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

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Server admins (web panel)
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Discord user ID"
                  value={newAdmin}
                  onChange={(e) => setNewAdmin(e.target.value)}
                />
                <Button
                  variant="tonal"
                  disabled={!newAdmin.trim()}
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
                        <Tooltip title="Remove admin">
                          <IconButton
                            edge="end"
                            onClick={() =>
                              api
                                .removeGuildAdmin(gid, a)
                                .then(() => refresh())
                                .catch(guard)
                            }
                          >
                            <Delete />
                          </IconButton>
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
