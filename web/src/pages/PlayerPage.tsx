import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import YouTube from "@mui/icons-material/YouTube";
import {
  IconAddToQueue as AddQueue,
  IconAllInclusive as AllInclusive,
  IconCloud as CloudQueue,
  IconDelete as DeleteOutlined,
  IconFavorite as Favorite,
  IconFolder as Folder,  IconGraphicEq as GraphicEq,
  IconHistory as History,
  IconKeyboardArrowDown as KeyboardArrowDown,
  IconKeyboardArrowUp as KeyboardArrowUp,
  IconLibraryMusic as LibraryMusic,
  IconMusicNote as MusicNote,
  IconPlayArrow as PlayArrow,
  IconPlaylistAdd as PlaylistAdd,
  IconRadio as RadioIcon,
  IconSearch as SearchIcon,
  IconShuffle as Shuffle,
  IconTag as TagIcon,
} from "../components/icons";
import {
  api,
  PlaylistPageInfo,
  TrackInfo,
  UserPlaylistFull,
} from "../api";
import { usePlayerState, useVoiceChannels, useFavorites, useMyPlaylists } from "../queries";
import { PlayerPageSkeleton } from "../components/Skeletons";
import { m3 } from "../theme";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { MsIcon } from "../components/MsIcon";
import { PlayerDock } from "../components/PlayerDock";
import { PlaylistBrowser } from "../components/PlaylistBrowser";
import { PlaylistAddMenu } from "../components/PlaylistAddMenu";
import { useFeedback } from "../components/Feedback";

const SOURCES: { id: string; label: string; icon: React.ReactElement }[] = [
  { id: "all", label: "All", icon: <AllInclusive fontSize="small" /> },
  { id: "yt", label: "YouTube", icon: <YouTube fontSize="small" /> },
  { id: "sc", label: "SoundCloud", icon: <CloudQueue fontSize="small" /> },
  { id: "ym", label: "Яндекс Музыка", icon: <MusicNote fontSize="small" /> },
  { id: "vk", label: "VK", icon: <TagIcon fontSize="small" /> },
  { id: "radio", label: "Radio", icon: <RadioIcon fontSize="small" /> },
  { id: "archive", label: "Archive.org", icon: <LibraryMusic fontSize="small" /> },
  { id: "local", label: "Local", icon: <Folder fontSize="small" /> },
];

const PLACEHOLDERS: Record<string, string> = {
  all: "Search all sources",
  yt: "Track name or URL",
  sc: "Search SoundCloud tracks",
  ym: "Поиск по Яндекс.Музыке",
  vk: "Track name or vk.com link (track, playlist, audios)",
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
  vk: "VK Music",
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
  const queryClient = useQueryClient();

  // Server state lives in the query cache: revisits render instantly while
  // the refresh happens in the background; the player state polls every 3s.
  const stateQuery = usePlayerState(gid);
  const state = stateQuery.data ?? null;
  const channelsQuery = useVoiceChannels(gid);
  const channels = channelsQuery.data ?? [];
  const favoritesQuery = useFavorites();
  const favorites = favoritesQuery.data ?? [];
  const myPlsQuery = useMyPlaylists();
  const myPls = myPlsQuery.data ?? [];

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
  const [openPl, setOpenPl] = useState<UserPlaylistFull | null>(null);
  const [newPlName, setNewPlName] = useState("");
  const [plBusy, setPlBusy] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);

  const invalidatePlayer = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["player", gid] });
    void queryClient.invalidateQueries({ queryKey: ["myPlaylists"] });
  }, [gid, queryClient]);

  useEffect(() => {
    if (state && volume === null) setVolume(Math.min(state.volume, 200));
  }, [state, volume]);

  useEffect(() => {
    setSelectedChannel((s) => s || channels[0]?.id || "");
  }, [channels]);

  const toggleFavorite = (t: TrackInfo) => {
    const existing = favorites.find((f) => f.uri === t.uri);
    const done = () => void queryClient.invalidateQueries({ queryKey: ["favorites"] });
    if (existing) {
      api.removeFavorite(existing.id).then(done).catch(guard);
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
      .then(done)
      .catch(guard);
  };

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") feedback.show(e.message, "error");
  };

  const act = (fn: () => Promise<unknown>, okMessage?: string) => {
    fn()
      .then(() => {
        if (okMessage) feedback.show(okMessage);
        invalidatePlayer();
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
        invalidatePlayer();
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
        invalidatePlayer();
      })
      .catch(guard)
      .finally(() => setPlaylistBusy(false));
  };

  const loadMyPls = () => {
    void queryClient.invalidateQueries({ queryKey: ["myPlaylists"] });
    return Promise.resolve();
  };

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

  // First load of the player state: skeleton mimicking the real layout.
  if (stateQuery.isPending) {
    return (
      <AppShell me={me} back>
        <PlayerPageSkeleton />
      </AppShell>
    );
  }

  // Right sidebar: voice connection on top, the queue fills the rest and
  // scrolls internally.
  const rightPanel = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
          <Card sx={{ flexShrink: 0 }}>
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
                    // The closed select renders bare children (no flex), so
                    // build the display row here to match the menu items.
                    renderValue={(value) => {
                      const channel = channels.find((c) => c.id === value);
                      return (
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <MsIcon name="volume_up" fontSize={18} sx={{ color: "text.secondary" }} />
                          {channel?.name}
                        </Stack>
                      );
                    }}
                  >
                    {channels.map((c) => (
                      <MenuItem key={c.id} value={c.id} sx={{ gap: 1 }}>
                        <MsIcon name="volume_up" fontSize={18} sx={{ color: "text.secondary" }} />
                        {c.name}
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
          <Card sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <CardContent sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "&:last-child": { pb: 2 } }}>
              <Stack spacing={1} sx={{ mb: 1.5, flexShrink: 0 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    Queue ({state?.queue.length ?? 0})
                  </Typography>
                  {!!state?.queue.length && (
                    <Tooltip title="Clear the queue">
                      <IconButton
                        size="small"
                        aria-label="Clear the queue"
                        onClick={() => act(() => api.clearQueue(gid), "Queue cleared")}
                      >
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {/* MD3 outlined segmented button: the view of the queue card. */}
                  <Box
                    sx={{
                      display: "inline-flex",
                      flex: 1,
                      border: "1px solid",
                      borderColor: "outlineVariant" as const,
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <Button
                      size="small"
                      variant={queueView === "next" ? "tonal" : "text"}
                      onClick={() => setQueueView("next")}
                      sx={{ borderRadius: 999, flex: 1, minWidth: 0, px: 1.5 }}
                    >
                      Up next
                    </Button>
                    <Button
                      size="small"
                      variant={queueView === "recent" ? "tonal" : "text"}
                      onClick={() => setQueueView("recent")}
                      sx={{ borderRadius: 999, flex: 1, minWidth: 0, px: 1.5 }}
                    >
                      Recent
                    </Button>
                  </Box>
                  {!!state?.queue.length && (
                    <Tooltip title="Shuffle the queue">
                      <IconButton
                        size="small"
                        aria-label="Shuffle the queue"
                        onClick={() => act(() => api.shuffleQueue(gid), "Queue shuffled")}
                      >
                        <Shuffle fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
              <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
                                sx={{ bgcolor: m3.surfaceContainerHighest, "&:hover": { bgcolor: m3.secondaryContainer } }}
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
                                sx={{ bgcolor: m3.surfaceContainerHighest, "&:hover": { bgcolor: m3.secondaryContainer }, ml: 0.25 }}
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
                                sx={{ bgcolor: m3.surfaceContainerHighest, "&:hover": { bgcolor: "rgba(242,185,181,0.12)", color: "error.main" }, ml: 0.25 }}
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
                    Queue is empty. Add tracks from the search.
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
                        <Box sx={{ display: "flex", gap: 0.5 }}>
                          <Tooltip title="Add to queue">
                            <IconButton
                              size="small"
                              aria-label="Add to queue"
                              onClick={(e) => {
                                e.stopPropagation();
                                act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`);
                              }}
                              sx={{
                                bgcolor: m3.surfaceContainerHighest,
                                "&:hover": { bgcolor: m3.secondaryContainer },
                                visibility: hoveredRow === `r${i}` ? "visible" : "hidden",
                                ["@media (hover: none)"]: { visibility: "visible" },
                              }}
                            >
                              <PlaylistAdd fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Play now">
                            <IconButton
                              size="small"
                              aria-label="Play now"
                              onClick={(e) => {
                                e.stopPropagation();
                                act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`);
                              }}
                              sx={{
                                bgcolor: m3.surfaceContainerHighest,
                                "&:hover": { bgcolor: m3.secondaryContainer },
                                visibility: hoveredRow === `r${i}` ? "visible" : "hidden",
                                ["@media (hover: none)"]: { visibility: "visible" },
                              }}
                            >
                              <PlayArrow fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
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
              </Box>
            </CardContent>
          </Card>
    </Box>
  );

  const dock = (
    <PlayerDock
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
  );

  return (
    <AppShell
      me={me}
      back
      title={state?.guild_name ?? undefined}
      right={rightPanel}
      rightBadge={state?.queue.length ?? 0}
      dock={dock}
    >
      {/* Wide screens: search/add on the left, playlists on the right. */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, gap: 2, alignItems: "start" }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Add music
              </Typography>
              {/* Phones: one swipeable chip row instead of a tall wrap. */}
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  flexWrap: { xs: "nowrap", sm: "wrap" },
                  overflowX: { xs: "auto", sm: "visible" },
                  mb: 2,
                  rowGap: 1,
                  pb: { xs: 0.5, sm: 0 },
                }}
              >
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
                    sx={{ flexShrink: 0 }}
                  />
                ))}
              </Stack>
              {source === "radio" && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{
                    flexWrap: { xs: "nowrap", sm: "wrap" },
                    overflowX: { xs: "auto", sm: "visible" },
                    mb: 1.5,
                    rowGap: 1,
                    pb: { xs: 0.5, sm: 0 },
                  }}
                >
                  {RADIO_PRESETS.map((preset) => (
                    <Chip
                      key={preset}
                      label={preset}
                      size="small"
                      variant="outlined"
                      sx={{ flexShrink: 0 }}
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
              {/* Phones: the field takes the full row, Queue URL moves below. */}
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ alignItems: { xs: "stretch", sm: "center" } }}
              >
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
                <Tooltip title="Add the link to the queue without searching">
                  <Button
                    variant="tonal"
                    sx={{ height: 40, flexShrink: 0, width: { xs: "100%", sm: "auto" } }}
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
                </Tooltip>
              </Stack>

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
                              <Favorite filled={favorites.some((f) => f.uri === t.uri)} fontSize="small" sx={favorites.some((f) => f.uri === t.uri) ? { color: "primary.main" } : { color: "text.secondary" }} />
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
                                  bgcolor: m3.surfaceContainerHigh,
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
                              onClick={() => api.removeFavorite(f.id).then(() => queryClient.invalidateQueries({ queryKey: ["favorites"] })).catch(guard)}
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
        </Stack>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Card>
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
        </Stack>
      </Box>

      {feedback.node}
    </AppShell>
  );
}
