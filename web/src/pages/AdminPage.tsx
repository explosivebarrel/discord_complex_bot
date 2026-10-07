import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
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
