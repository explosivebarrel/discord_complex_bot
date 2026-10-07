import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  Skeleton,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddQueue from "@mui/icons-material/Queue";
import GraphicEq from "@mui/icons-material/GraphicEq";
import MusicNote from "@mui/icons-material/MusicNote";
import CloudQueue from "@mui/icons-material/CloudQueue";
import RadioIcon from "@mui/icons-material/Radio";
import LibraryMusic from "@mui/icons-material/LibraryMusic";
import YouTube from "@mui/icons-material/YouTube";
import VolumeUp from "@mui/icons-material/VolumeUp";
import { api, PlayerState, TrackInfo, VoiceChannel } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { PlayerBar } from "../components/PlayerBar";
import { useFeedback } from "../components/Feedback";

const SOURCES: { id: string; label: string; icon: React.ReactElement }[] = [
  { id: "yt", label: "YouTube", icon: <YouTube fontSize="small" /> },
  { id: "sc", label: "SoundCloud", icon: <CloudQueue fontSize="small" /> },
  { id: "ym", label: "Яндекс Музыка", icon: <MusicNote fontSize="small" /> },
  { id: "radio", label: "Radio", icon: <RadioIcon fontSize="small" /> },
  { id: "archive", label: "Archive.org", icon: <LibraryMusic fontSize="small" /> },
];

const PLACEHOLDERS: Record<string, string> = {
  yt: "Track name or URL",
  sc: "Search SoundCloud tracks",
  ym: "Поиск по Яндекс.Музыке",
  radio: "Station name or genre (jazz, rock, news…)",
  archive: "Search audio on Archive.org",
};

const LIVE_LENGTH = 9223372036854775807;

const SOURCE_LABELS: Record<string, string> = {
  yt: "YouTube",
  sc: "SoundCloud",
  ym: "Яндекс Музыка",
  radio: "Radio",
  archive: "Archive.org",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
};

function fmt(ms: number): string {
  if (ms >= LIVE_LENGTH) return "LIVE";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PlayerPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const feedback = useFeedback();

  const [state, setState] = useState<PlayerState | null>(null);
  const [channels, setChannels] = useState<VoiceChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("yt");
  const [results, setResults] = useState<TrackInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [enqueueing, setEnqueueing] = useState<string | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    api
      .playerState(gid)
      .then((s) => {
        setState(s);
        setVolume((v) => (v === null ? Math.min(s.volume, 200) : v));
      })
      .catch((e: Error) => {
        if (e.message !== "unauthorized") feedback.show(e.message, "error");
      });
  }, [gid]);

  useEffect(() => {
    refresh();
    api
      .voiceChannels(gid)
      .then((ch) => {
        setChannels(ch);
        setSelectedChannel((s) => s || ch[0]?.id || "");
      })
      .catch(() => setChannels([]));
    pollRef.current = setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [gid, refresh]);

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") feedback.show(e.message, "error");
  };

  const act = (fn: () => Promise<unknown>, okMessage?: string) => {
    fn()
      .then(() => {
        if (okMessage) feedback.show(okMessage);
        refresh();
      })
      .catch(guard);
  };

  const doSearch = () => {
    if (!query.trim()) return;
    setSearching(true);
    api
      .search(gid, query, source)
      .then((r) => setResults(r))
      .catch(guard)
      .finally(() => setSearching(false));
  };

  const enqueue = (key: string, body: { query?: string; encoded?: string; source?: string }) => {
    if (enqueueing !== null) return;
    setEnqueueing(key);
    api
      .enqueue(gid, body)
      .then((r) => {
        feedback.show(r.now_playing ? `Now playing: ${r.title}` : `Queued: ${r.title}`);
        setResults(null);
        setQuery("");
        refresh();
      })
      .catch(guard)
      .finally(() => setEnqueueing(null));
  };

  if (loading) {
    return (
      <AppShell me={me} back>
        <Box sx={{ display: "grid", placeItems: "center", py: 10 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title={state?.guild_name ?? undefined}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{
          alignItems: "flex-start",
          minHeight: { md: "calc(100dvh - 190px)" },
          // Must exceed the floating player bar (about 128 px) plus a gap.
          pb: { xs: 22, sm: 18 },
        }}
      >
        {/* Left column: search */}
        <Box sx={{ flex: { md: "1 1 58%" }, minWidth: 0, width: "100%" }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Add music
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", mb: 2, rowGap: 1 }}>
                {SOURCES.map((s) => (
                  <Chip
                    key={s.id}
                    icon={s.icon}
                    label={s.label}
                    clickable
                    color={source === s.id ? "primary" : "default"}
                    variant={source === s.id ? "filled" : "outlined"}
                    onClick={() => {
                      setSource(s.id);
                      setResults(null);
                    }}
                  />
                ))}
              </Stack>
              <TextField
                fullWidth
                placeholder={PLACEHOLDERS[source]}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <Button onClick={doSearch} disabled={searching || !query.trim()}>
                          {searching ? <CircularProgress size={18} /> : "Search"}
                        </Button>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Button
                variant="tonal"
                sx={{ mt: 1.5 }}
                disabled={!query.trim() || enqueueing !== null}
                onClick={() => query.trim() && enqueue("url", { query, source })}
              >
                {enqueueing === "url" ? (
                  <CircularProgress size={16} sx={{ mr: 0.75 }} />
                ) : (
                  <AddQueue fontSize="small" sx={{ mr: 0.75 }} />
                )}
                Queue URL
              </Button>

              <Box sx={{ mt: 2 }}>
                {searching ? (
                  [0, 1, 2].map((i) => (
                    <Box key={i} sx={{ display: "flex", gap: 2, py: 1 }}>
                      <Skeleton variant="rounded" width={48} height={48} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton width="70%" />
                        <Skeleton width="40%" />
                      </Box>
                    </Box>
                  ))
                ) : results && results.length === 0 ? (
                  <Typography variant="body2" sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
                    Nothing found.
                  </Typography>
                ) : (
                  results && (
                    <List disablePadding>
                      {results.map((t, i) => (
                        <ListItem
                          key={i}
                          disablePadding
                          secondaryAction={
                            <Button
                              size="small"
                              variant="tonal"
                              disabled={enqueueing !== null}
                              startIcon={enqueueing === `t${i}` ? <CircularProgress size={14} /> : undefined}
                              onClick={() => {
                                enqueue(
                                  `t${i}`,
                                  t.encoded ? { encoded: t.encoded, source } : { query: t.uri ?? t.title, source },
                                );
                              }}
                            >
                              Queue
                            </Button>
                          }
                        >
                          <ListItemAvatar>
                            {t.artwork ? (
                              <Box
                                component="img"
                                src={t.artwork}
                                sx={{ width: 48, height: 48, borderRadius: "8px", objectFit: "cover" }}
                              />
                            ) : (
                              <Box
                                sx={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: "8px",
                                  bgcolor: "#2B2930",
                                  display: "grid",
                                  placeItems: "center",
                                }}
                              >
                                <MusicNote sx={{ color: "text.secondary" }} />
                              </Box>
                            )}
                          </ListItemAvatar>
                          <ListItemText
                            primary={t.title}
                            secondary={`${t.author ?? ""} · ${t.length >= LIVE_LENGTH || t.length === 0 ? "LIVE" : fmt(t.length)}`}
                            slotProps={{
                              primary: { noWrap: true, sx: { pr: 2 } },
                              secondary: { noWrap: true, sx: { pr: 2 } },
                            }}
                          />
                        </ListItem>
                      ))}
                    </List>
                  )
                )}
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* Right column: voice + queue + volume */}
        <Stack spacing={2} sx={{ flex: { md: "1 1 42%" }, minWidth: 0, width: "100%" }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Voice connection
              </Typography>
              {state?.connected ? (
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <GraphicEq sx={{ color: "success.main" }} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {state.channel_name}
                  </Typography>
                  <Button size="small" variant="outlined" onClick={() => act(() => api.leave(gid))}>
                    Leave
                  </Button>
                </Stack>
              ) : channels.length > 0 ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Select
                    fullWidth
                    size="small"
                    value={selectedChannel}
                    onChange={(e) => setSelectedChannel(e.target.value as string)}
                    displayEmpty
                  >
                    {channels.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        🔊 {c.name}
                      </MenuItem>
                    ))}
                  </Select>
                  <Button
                    variant="contained"
                    disabled={!selectedChannel}
                    onClick={() => act(() => api.join(gid, selectedChannel), "Connected")}
                  >
                    Join
                  </Button>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  No voice channels available.
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Queue ({state?.queue.length ?? 0})
              </Typography>
              {state && state.queue.length > 0 ? (
                <List disablePadding>
                  {state.queue.map((t, i) => (
                    <ListItem key={i} disableGutters dense>
                      <ListItemAvatar sx={{ minWidth: 36 }}>
                        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
                          {i + 1}
                        </Typography>
                      </ListItemAvatar>
                      <ListItemText
                        primary={t.title}
                        secondary={[SOURCE_LABELS[t.source ?? ""] ?? "", t.requested_by].filter(Boolean).join(" · ")}
                        slotProps={{
                          primary: { noWrap: true },
                          secondary: { noWrap: true },
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Queue is empty. Add something above.
                </Typography>
              )}
            </CardContent>
          </Card>

          {state?.connected && (
            <Card>
              <CardContent>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <VolumeUp sx={{ color: "text.secondary" }} />
                  <Slider
                    size="small"
                    min={0}
                    max={200}
                    value={volume ?? 100}
                    onChange={(_event, v) => setVolume(v as number)}
                    onChangeCommitted={(_event, v) => act(() => api.volume(gid, v as number))}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(v) => `${v}%`}
                  />
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Stack>

      <PlayerBar
        state={state}
        volume={volume ?? 100}
        onVolumeChange={(v) => setVolume(v)}
        onVolumeCommit={(v) => act(() => api.volume(gid, v))}
        onPauseToggle={() => act(() => api.simpleAction(gid, state?.current?.paused ? "resume" : "pause"))}
        onSkip={() => act(() => api.simpleAction(gid, "skip"))}
        onStop={() => act(() => api.simpleAction(gid, "stop"), "Stopped, queue cleared")}
        onSeek={(p) => act(() => api.seek(gid, p))}
      />
      {feedback.node}
    </AppShell>
  );
}
