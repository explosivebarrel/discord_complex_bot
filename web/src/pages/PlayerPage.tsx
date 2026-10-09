import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
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
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddQueue from "@mui/icons-material/Queue";
import GraphicEq from "@mui/icons-material/GraphicEq";
import MusicNote from "@mui/icons-material/MusicNote";
import CloudQueue from "@mui/icons-material/CloudQueue";
import RadioIcon from "@mui/icons-material/Radio";
import LibraryMusic from "@mui/icons-material/LibraryMusic";
import Folder from "@mui/icons-material/Folder";
import YouTube from "@mui/icons-material/YouTube";
import VolumeUp from "@mui/icons-material/VolumeUp";
import AllInclusive from "@mui/icons-material/AllInclusive";
import KeyboardArrowUp from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import Favorite from "@mui/icons-material/Favorite";
import FavoriteBorder from "@mui/icons-material/FavoriteBorder";
import PlayArrow from "@mui/icons-material/PlayArrow";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import Shuffle from "@mui/icons-material/Shuffle";
import History from "@mui/icons-material/History";
import {
  api,
  FavoriteTrackInfo,
  PlayerState,
  PlaylistPageInfo,
  TrackInfo,
  UserPlaylistBrief,
  UserPlaylistFull,
  VoiceChannel,
} from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { PlayerBar } from "../components/PlayerBar";
import { PlaylistBrowser } from "../components/PlaylistBrowser";
import { PlaylistAddMenu } from "../components/PlaylistAddMenu";
import { useFeedback } from "../components/Feedback";

const SOURCES: { id: string; label: string; icon: React.ReactElement }[] = [
  { id: "all", label: "All", icon: <AllInclusive fontSize="small" /> },
  { id: "yt", label: "YouTube", icon: <YouTube fontSize="small" /> },
  { id: "sc", label: "SoundCloud", icon: <CloudQueue fontSize="small" /> },
  { id: "ym", label: "Яндекс Музыка", icon: <MusicNote fontSize="small" /> },
  { id: "radio", label: "Radio", icon: <RadioIcon fontSize="small" /> },
  { id: "archive", label: "Archive.org", icon: <LibraryMusic fontSize="small" /> },
  { id: "local", label: "Local", icon: <Folder fontSize="small" /> },
];

const PLACEHOLDERS: Record<string, string> = {
  all: "Search all sources",
  yt: "Track name or URL",
  sc: "Search SoundCloud tracks",
  ym: "Поиск по Яндекс.Музыке",
  radio: "Station name or genre (jazz, rock, news…)",
  archive: "Search audio on Archive.org",
  local: "Search files in the server library (data/music)",
};

const LIVE_LENGTH = 9223372036854775807;

const RADIO_PRESETS = ["lofi", "jazz", "rock", "classical", "news", "dance", "chill"];

const SOURCE_LABELS: Record<string, string> = {
  yt: "YouTube",
  sc: "SoundCloud",
  ym: "Яндекс Музыка",
  yandexmusic: "Яндекс Музыка",
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
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [queueView, setQueueView] = useState<"next" | "recent">("next");
  const [playlist, setPlaylist] = useState<PlaylistPageInfo | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  // HTML5 drag and drop of queue rows. The source index rides through the
  // dataTransfer so a re-render between dragstart and drop cannot lose it.
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [volInput, setVolInput] = useState<string | null>(null);
  const [myPls, setMyPls] = useState<UserPlaylistBrief[]>([]);
  const [openPl, setOpenPl] = useState<UserPlaylistFull | null>(null);
  const [newPlName, setNewPlName] = useState("");
  const [plBusy, setPlBusy] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteTrackInfo[]>([]);
  const [volume, setVolume] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    api
      .myPlaylists()
      .then(setMyPls)
      .catch(() => {});
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

  const loadFavorites = useCallback(() => {
    api
      .favorites()
      .then(setFavorites)
      .catch(() => setFavorites([]));
  }, []);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const toggleFavorite = (t: TrackInfo) => {
    const existing = favorites.find((f) => f.uri === t.uri);
    if (existing) {
      api
        .removeFavorite(existing.id)
        .then(() => loadFavorites())
        .catch(guard);
      return;
    }
    api
      .addFavorite({
        title: t.title,
        author: t.author ?? undefined,
        uri: t.uri ?? "",
        source: t.source ?? undefined,
        length_ms: t.length,
        artwork: t.artwork,
      })
      .then(() => loadFavorites())
      .catch(guard);
  };

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

  const enqueue = (key: string, body: Parameters<typeof api.enqueue>[1]) => {
    if (enqueueing !== null) return;
    setEnqueueing(key);
    api
      .enqueue(gid, body)
      .then((r) => {
        if (r.preview) {
          setPlaylist(r.preview);
          feedback.show("Playlist loaded. Pick the tracks you want.");
        } else {
          feedback.show(r.now_playing ? `Now playing: ${r.title}` : `Queued: ${r.title}`);
        }
        setResults(null);
        setQuery("");
        refresh();
      })
      .catch(guard)
      .finally(() => setEnqueueing(null));
  };

  const openPlaylistPage = (pid: number, page: number, q: string) => {
    setPlaylistBusy(true);
    api
      .playlistPage(gid, pid, page, q)
      .then(setPlaylist)
      .catch(guard)
      .finally(() => setPlaylistBusy(false));
  };

  const playlistAction = (fn: () => Promise<unknown>, okMsg: string) => {
    setPlaylistBusy(true);
    fn()
      .then(() => {
        feedback.show(okMsg);
        refresh();
      })
      .catch(guard)
      .finally(() => setPlaylistBusy(false));
  };

  const commitVolume = () => {
    const parsed = Number(volInput);
    if (Number.isNaN(parsed)) {
      setVolInput(null);
      return;
    }
    const clamped = Math.max(0, Math.min(200, Math.round(parsed)));
    setVolInput(null);
    setVolume(clamped);
    act(() => api.volume(gid, clamped), `Volume: ${clamped}%`);
  };

  const loadMyPls = () =>
    api
      .myPlaylists()
      .then(setMyPls)
      .catch(guard);

  const plAction = (fn: () => Promise<unknown>, okMsg?: string, after?: () => void) => {
    setPlBusy(true);
    fn()
      .then(() => {
        if (okMsg) feedback.show(okMsg);
        after?.();
      })
      .catch(guard)
      .finally(() => setPlBusy(false));
  };

  const createPlaylist = () => {
    const name = newPlName.trim();
    if (!name || plBusy) return;
    plAction(
      async () => {
        await api.createUserPlaylist(name);
        setNewPlName("");
        await loadMyPls();
      },
      `Playlist "${name}" created`,
    );
  };

  const openPlaylistTracks = (pid: number) => {
    setPlBusy(true);
    api
      .userPlaylist(pid)
      .then(setOpenPl)
      .catch(guard)
      .finally(() => setPlBusy(false));
  };

  const cycleRepeat = () => {
    const next = state?.repeat === "all" ? "one" : state?.repeat === "one" ? "off" : "all";
    act(() => api.repeat(gid, next), `Repeat: ${next}`);
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
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2, rowGap: 1 }}>
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
              {source === "radio" && (
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5, rowGap: 1 }}>
                  {RADIO_PRESETS.map((preset) => (
                    <Chip
                      key={preset}
                      label={preset}
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setQuery(preset);
                        setSearching(true);
                        api
                          .search(gid, preset, "radio")
                          .then((r) => setResults(r))
                          .catch(guard)
                          .finally(() => setSearching(false));
                      }}
                    />
                  ))}
                </Stack>
              )}
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
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                              <Tooltip
                                title={
                                  favorites.some((f) => f.uri === t.uri)
                                    ? "Remove from favorites"
                                    : "Add to favorites"
                                }
                              >
                              <IconButton
                                size="small"
                                onClick={() => toggleFavorite(t)}
                                sx={
                                  favorites.some((f) => f.uri === t.uri)
                                    ? { color: "primary.main" }
                                    : { color: "text.secondary" }
                                }
                              >
                                {favorites.some((f) => f.uri === t.uri) ? (
                                  <Favorite fontSize="small" />
                                ) : (
                                  <FavoriteBorder fontSize="small" />
                                )}
                              </IconButton>
                              </Tooltip>
                              {t.issue && (
                                <Chip
                                  size="small"
                                  label={t.issue.toUpperCase()}
                                  color="error"
                                  variant="outlined"
                                  sx={{ height: 20, fontSize: 11 }}
                                />
                              )}
                              <PlaylistAddMenu
                                track={{
                                  title: t.title,
                                  author: t.author,
                                  uri: t.uri ?? "",
                                  source: t.source ?? source,
                                  length_ms: t.length,
                                  artwork: t.artwork,
                                }}
                              />
                              <Button
                                size="small"
                                variant="tonal"
                                disabled={enqueueing !== null}
                                startIcon={enqueueing === `t${i}` ? <CircularProgress size={14} /> : undefined}
                                onClick={() => {
                                  enqueue(
                                    `t${i}`,
                                    t.encoded
                                      ? { encoded: t.encoded, source: t.source ?? source }
                                      : { query: t.uri ?? t.title, source: t.source ?? source },
                                  );
                                }}
                              >
                                Queue
                              </Button>
                            </Stack>
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
                            secondary={[
                              SOURCE_LABELS[t.source ?? ""] ?? "",
                              t.author ?? "",
                              t.length > 0 ? fmt(t.length) : t.source === "local" ? "file" : "LIVE",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
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
          {favorites.length > 0 && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Favorites ({favorites.length})
                </Typography>
                <List disablePadding>
                  {favorites.slice(0, 10).map((f) => (
                    <ListItem
                      key={f.id}
                      disableGutters
                      dense
                      secondaryAction={
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Play now">
                            <IconButton
                              size="small"
                              onClick={() =>
                                enqueue(`f${f.id}`, {
                                  query: f.uri,
                                  source: f.source || "yt",
                                  title: f.title,
                                  author: f.author,
                                  length_ms: f.length_ms,
                                  artwork: f.artwork,
                                })
                              }
                            >
                              <PlayArrow fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Remove from favorites">
                            <IconButton
                              size="small"
                              onClick={() => api.removeFavorite(f.id).then(loadFavorites).catch(guard)}
                            >
                              <Favorite fontSize="small" sx={{ color: "primary.main" }} />
                            </IconButton>
                          </Tooltip>
                          <PlaylistAddMenu
                            track={{
                              title: f.title,
                              author: f.author,
                              uri: f.uri,
                              source: f.source,
                              length_ms: f.length_ms,
                              artwork: f.artwork,
                            }}
                          />
                        </Stack>
                      }
                    >
                      <ListItemText
                        primary={f.title}
                        secondary={[SOURCE_LABELS[f.source] ?? "", f.author].filter(Boolean).join(" · ")}
                        slotProps={{ primary: { noWrap: true, sx: { pr: 2 } }, secondary: { noWrap: true, sx: { pr: 2 } } }}
                      />
                    </ListItem>
                  ))}
                </List>
                {favorites.length > 10 && (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    And {favorites.length - 10} more.
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}
          <Card sx={{ mt: 2 }}>
            <CardContent>
              {openPl ? (
                <>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                    <Button size="small" variant="text" onClick={() => setOpenPl(null)}>
                      Back
                    </Button>
                    <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {openPl.name}
                    </Typography>
                    <Button
                      size="small"
                      variant="tonal"
                      disabled={plBusy || openPl.tracks.length === 0}
                      onClick={() =>
                        plAction(
                          () => api.queueUserPlaylist(gid, openPl.id),
                          `Queued ${openPl.tracks.length} track(s)`,
                        )
                      }
                    >
                      Queue all
                    </Button>
                  </Stack>
                  <List disablePadding>
                    {openPl.tracks.map((t, i) => (
                      <ListItem
                        key={t.id}
                        disableGutters
                        dense
                        secondaryAction={
                          <Stack direction="row" spacing={0.5}>
                            <Tooltip title="Play now">
                              <IconButton
                                size="small"
                                disabled={plBusy}
                                onClick={() =>
                                  plAction(
                                    () => api.playUserPlaylistTrack(gid, openPl.id, i),
                                    `Now playing: ${t.title}`,
                                  )
                                }
                              >
                                <PlayArrow fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Remove from playlist">
                              <IconButton
                                size="small"
                                disabled={plBusy}
                                onClick={() =>
                                  plAction(async () => {
                                    await api.removeUserPlaylistTrack(openPl.id, t.id);
                                    setOpenPl(await api.userPlaylist(openPl.id));
                                  })
                                }
                              >
                                <DeleteOutlined fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        }
                      >
                        <ListItemAvatar sx={{ minWidth: 36 }}>
                          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
                            {i + 1}
                          </Typography>
                        </ListItemAvatar>
                        <ListItemText
                          primary={t.title}
                          secondary={[SOURCE_LABELS[t.source] ?? "", t.author].filter(Boolean).join(" · ")}
                          slotProps={{
                            primary: { noWrap: true, sx: { pr: 2 } },
                            secondary: { noWrap: true, sx: { pr: 2 } },
                          }}
                        />
                      </ListItem>
                    ))}
                    {openPl.tracks.length === 0 && (
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        The playlist is empty. Add tracks from search or the queue.
                      </Typography>
                    )}
                  </List>
                </>
              ) : (
                <>
                  <Typography variant="h6" gutterBottom>
                    My playlists
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="New playlist name"
                      value={newPlName}
                      onChange={(e) => setNewPlName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
                    />
                    <Button variant="tonal" disabled={!newPlName.trim() || plBusy} onClick={createPlaylist}>
                      Create
                    </Button>
                  </Stack>
                  {myPls.length > 0 ? (
                    <List disablePadding>
                      {myPls.map((p) => (
                        <ListItem
                          key={p.id}
                          disableGutters
                          dense
                          secondaryAction={
                            <Stack direction="row" spacing={0.5}>
                              <Tooltip title="Open playlist">
                                <IconButton size="small" disabled={plBusy} onClick={() => openPlaylistTracks(p.id)}>
                                  <PlayArrow fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete playlist">
                                <IconButton
                                  size="small"
                                  disabled={plBusy}
                                  onClick={() =>
                                    plAction(
                                      () => api.deleteUserPlaylist(p.id),
                                      `Playlist "${p.name}" deleted`,
                                      loadMyPls,
                                    )
                                  }
                                >
                                  <DeleteOutlined fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          }
                        >
                          <ListItem
                            disableGutters
                            dense
                            component="div"
                            onClick={() => openPlaylistTracks(p.id)}
                            sx={{ cursor: "pointer", flex: 1, minWidth: 0, pr: 1 }}
                          >
                            <ListItemText
                              primary={p.name}
                              secondary={`${p.tracks} track(s) - click to open`}
                              slotProps={{
                                primary: { noWrap: true, sx: { pr: 2 } },
                                secondary: { noWrap: true, sx: { pr: 2 } },
                              }}
                            />
                          </ListItem>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      No playlists yet. Create one and add tracks from search or the queue.
                    </Typography>
                  )}
                </>
              )}
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

          {state?.connected && (
            <Card>
              {/* CardContent pads the last child to 24px; keep this compact card even. */}
              <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                  <VolumeUp sx={{ color: "text.secondary" }} />
                  <Slider
                    size="small"
                    min={0}
                    max={200}
                    value={volume ?? 100}
                    onChange={(_event, v) => setVolume(v as number)}
                    onChangeCommitted={(_event, v) => act(() => api.volume(gid, v as number))}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    value={volInput ?? String(volume ?? 100)}
                    onChange={(e) => setVolInput(e.target.value)}
                    onBlur={commitVolume}
                    onKeyDown={(e) => e.key === "Enter" && commitVolume()}
                    slotProps={{
                      htmlInput: { min: 0, max: 200, style: { textAlign: "center" } },
                      input: { className: "volume-input", endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    }}
                    sx={{ width: 92 }}
                  />
                </Stack>
              </CardContent>
            </Card>
          )}
          {playlist && (
            <PlaylistBrowser
              playlist={playlist}
              busy={playlistBusy}
              onClose={() => setPlaylist(null)}
              onReload={(page, q) => openPlaylistPage(playlist.id, page, q)}
              onPlay={(index) =>
                playlistAction(() => api.playlistPlay(gid, playlist.id, index), "Playing from playlist")
              }
              onAdd={(indices) =>
                playlistAction(
                  () => api.playlistAdd(gid, playlist.id, indices),
                  `Added ${indices.length} track(s) to the queue`,
                )
              }
              onAddAll={() =>
                playlistAction(() => api.playlistAddAll(gid, playlist.id), "Whole playlist queued (lazy)")
              }
            />
          )}
          <Card>
            <CardContent>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: "center", mb: 1, flexWrap: "wrap" }}>
                <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }}>
                  Queue ({state?.queue.length ?? 0})
                </Typography>
                {/* MD3 segmented button: the view of the queue card. */}
                <Box
                  sx={{
                    display: "inline-flex",
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 999,
                    overflow: "hidden",
                  }}
                >
                  <Button
                    size="small"
                    variant={queueView === "next" ? "tonal" : "text"}
                    onClick={() => setQueueView("next")}
                    sx={{ borderRadius: 999, minWidth: 0, px: 1.5 }}
                  >
                    Up next
                  </Button>
                  <Button
                    size="small"
                    variant={queueView === "recent" ? "tonal" : "text"}
                    onClick={() => setQueueView("recent")}
                    sx={{ borderRadius: 999, minWidth: 0, px: 1.5 }}
                  >
                    Recent
                  </Button>
                </Box>
                <Button
                  size="small"
                  variant="tonal"
                  startIcon={<Shuffle />}
                  disabled={!state?.queue.length}
                  onClick={() => act(() => api.shuffleQueue(gid), "Queue shuffled")}
                >
                  Shuffle
                </Button>
                <Button
                  size="small"
                  variant="tonal"
                  disabled={!state?.queue.length}
                  onClick={() => act(() => api.clearQueue(gid), "Queue cleared")}
                >
                  Clear
                </Button>
              </Stack>
              {queueView === "next" ? (
                state && state.queue.length > 0 ? (
                  <List disablePadding>
                    {state.queue.map((t, i) => {
                      if (t.source === "playlist") {
                        return (
                          <ListItem
                            key={`pl${i}`}
                            disableGutters
                            dense
                            onClick={() =>
                            plAction(
                              () => api.expandQueuedPlaylist(gid, i),
                              "50 more tracks queued",
                            )
                          }
                            sx={{
                              cursor: "pointer",
                              borderRadius: 1,
                              "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
                            }}
                          >
                            <ListItemAvatar sx={{ minWidth: 36 }}>
                              <LibraryMusic fontSize="small" sx={{ color: "text.secondary", ml: 1 }} />
                            </ListItemAvatar>
                            <ListItemText
                              primary={t.title}
                              secondary={[t.author, "click to browse"].filter(Boolean).join(" · ")}
                              slotProps={{
                                primary: { noWrap: true },
                                secondary: { noWrap: true },
                              }}
                            />
                          </ListItem>
                        );
                      }
                      return (
                      <ListItem
                        key={i}
                        disableGutters
                        dense
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", String(i));
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDragOverIndex(i);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverIndex(null);
                          const from = Number(e.dataTransfer.getData("text/plain"));
                          if (!Number.isInteger(from) || from === i || Number.isNaN(from)) return;
                          act(() => api.moveQueued(gid, from, i), "Queue reordered");
                        }}
                        onDragEnd={() => setDragOverIndex(null)}
                        onClick={() => act(() => api.jumpQueued(gid, i), `Now playing: ${t.title}`)}
                        sx={{
                          cursor: "pointer",
                          borderRadius: 1,
                          "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
                          ...(dragOverIndex === i && { bgcolor: "rgba(255,255,255,0.09)" }),
                        }}
                        onMouseEnter={() => setHoveredRow(`q${i}`)}
                        onMouseLeave={() => setHoveredRow((h) => (h === `q${i}` ? null : h))}
                        secondaryAction={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              // Row actions appear on hover; touch devices have
                              // no hover, so they stay visible there.
                              visibility: hoveredRow === `q${i}` ? "visible" : "hidden",
                              ["@media (hover: none)"]: { visibility: "visible" },
                            }}
                          >
                            <Tooltip title="Move up">
                              <IconButton
                                size="small"
                                disabled={i === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  act(() => api.moveQueued(gid, i, i - 1));
                                }}
                                sx={{ bgcolor: "#313038", "&:hover": { bgcolor: "#3D3847" } }}
                              >
                                <KeyboardArrowUp fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Move down">
                              <IconButton
                                size="small"
                                disabled={i === state.queue.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  act(() => api.moveQueued(gid, i, i + 1));
                                }}
                                sx={{ bgcolor: "#313038", "&:hover": { bgcolor: "#3D3847" }, ml: 0.25 }}
                              >
                                <KeyboardArrowDown fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Remove from queue">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  act(() => api.removeQueued(gid, i));
                                }}
                                sx={{ bgcolor: "#313038", "&:hover": { bgcolor: "#4A3038", color: "error.main" }, ml: 0.25 }}
                              >
                                <DeleteOutlined fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Box sx={{ ml: 0.25 }} onClick={(e) => e.stopPropagation()}>
                              <PlaylistAddMenu
                                track={{
                                  title: t.title,
                                  author: t.author,
                                  uri: t.uri ?? "",
                                  source: t.source ?? "",
                                  length_ms: t.length,
                                  artwork: t.artwork,
                                }}
                              />
                            </Box>
                          </Box>
                        }
                      >
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
                      );
                    })}
                  </List>
                ) : (
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Queue is empty. Add something above.
                  </Typography>
                )
              ) : state && state.played.length > 0 ? (
                <List disablePadding>
                  {state.played.map((t, i) => (
                    <ListItem
                      key={`r${i}`}
                      disableGutters
                      dense
                      onClick={() => act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`)}
                      sx={{
                        cursor: "pointer",
                        borderRadius: 1,
                        "&:hover": { bgcolor: "rgba(255,255,255,0.04)" },
                      }}
                      onMouseEnter={() => setHoveredRow(`r${i}`)}
                      onMouseLeave={() => setHoveredRow((h) => (h === `r${i}` ? null : h))}
                      secondaryAction={
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`);
                          }}
                          sx={{
                            bgcolor: "#313038",
                            "&:hover": { bgcolor: "#3D3847" },
                            visibility: hoveredRow === `r${i}` ? "visible" : "hidden",
                            ["@media (hover: none)"]: { visibility: "visible" },
                          }}
                        >
                          <PlayArrow fontSize="small" />
                        </IconButton>
                      }
                    >
                      <ListItemAvatar sx={{ minWidth: 36 }}>
                        <History fontSize="small" sx={{ color: "text.secondary" }} />
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
                  Nothing played yet in this session.
                </Typography>
              )}
            </CardContent>
          </Card>

        </Stack>
      </Stack>

      <PlayerBar
        state={state}
        volume={volume ?? 100}
        onVolumeChange={(v) => setVolume(v)}
        onVolumeCommit={(v) => act(() => api.volume(gid, v))}
        onPauseToggle={() => act(() => api.simpleAction(gid, state?.current?.paused ? "resume" : "pause"))}
        onPrevious={() => act(() => api.simpleAction(gid, "previous"), "Playing the previous track")}
        onSkip={() => act(() => api.simpleAction(gid, "skip"))}
        onStop={() => act(() => api.simpleAction(gid, "stop"), "Stopped, queue cleared")}
        onSeek={(p) => act(() => api.seek(gid, p))}
        onRepeatCycle={cycleRepeat}
      />
      {feedback.node}
    </AppShell>
  );
}
