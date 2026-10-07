import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
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
  Typography,
} from "@mui/material";
import Delete from "@mui/icons-material/Delete";
import { api, GuildSettings } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { useFeedback } from "../components/Feedback";

export function AdminPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newAdmin, setNewAdmin] = useState("");
  const [autoplay, setAutoplay] = useState<{ enabled: boolean; query: string } | null>(null);

  const guard = (e: Error) => feedback.show(e.message, "error");

  const refresh = useCallback(() => {
    api
      .guildSettings(gid)
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    api
      .voiceChannels(gid)
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [gid]);

  useEffect(refresh, [refresh]);

  // Keep the local autoplay form in sync with the loaded settings.
  useEffect(() => {
    if (settings) setAutoplay({ enabled: settings.autoplay_enabled, query: settings.autoplay_query });
  }, [settings]);

  if (loading) {
    return (
      <AppShell me={me} back title="Manage">
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading…
        </Typography>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title={settings?.guild.name ?? "Manage"}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Manage server
      </Typography>
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
                    setSettings({
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
                        setSettings(s);
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
                          setSettings(s);
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
                      .then((r) => {
                        setSettings({ ...settings, admins: r.admins });
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
                        <IconButton
                          edge="end"
                          onClick={() =>
                            api
                              .removeGuildAdmin(gid, a)
                              .then((r) => setSettings({ ...settings, admins: r.admins }))
                              .catch(guard)
                          }
                        >
                          <Delete />
                        </IconButton>
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
