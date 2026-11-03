import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import YouTube from "@mui/icons-material/YouTube";
import {
  IconAllInclusive as AllInclusive,
  IconCloud as CloudQueue,
  IconDelete as DeleteOutlined,
  IconFolder as Folder,
  IconGraphicEq as GraphicEq,
  IconHistory as History,
  IconKeyboardArrowDown as KeyboardArrowDown,
  IconKeyboardArrowUp as KeyboardArrowUp,
  IconLibraryMusic as LibraryMusic,
  IconMusicNote as MusicNote,
  IconPlayArrow as PlayArrow,
  IconPlaylistAdd as PlaylistAdd,
  IconRadio as RadioIcon,
  IconShuffle as Shuffle,
  IconTag as TagIcon,
} from "../components/icons";
import {
  api,
  PlaylistPageInfo,
  TrackInfo,
  UserPlaylistFull,
} from "../api";
import { usePlayerState, useVoiceChannels, useFavorites, useGuilds, useGuildUploads, useMyPlaylists } from "../queries";
import { PlayerPageSkeleton } from "../components/Skeletons";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { PlayerDock } from "../components/PlayerDock";
import { MsIcon } from "../components/MsIcon";
import { PlaylistAddMenu } from "../components/PlaylistAddMenu";
import { useFeedback } from "../components/Feedback";
import { fmt, SOURCE_LABELS } from "../components/player/labels";
import { PLAYER_TABS, PlayerNav, type PlayerTab } from "../components/player/PlayerNav";
import { HomeRail, MediaCard, SearchBar, SearchResults } from "../components/player/SearchTab";
import { CollectionTab } from "../components/player/CollectionTab";
import { HistoryTab } from "../components/player/HistoryTab";
import { useLocalPref } from "../useLocalPref";
import { useLocalPrefValue } from "../useLocalPrefValue";

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

const RADIO_PRESETS = ["lofi", "jazz", "rock", "classical", "news", "dance", "chill"];

const UPLOAD_ACCEPT = ".mp3,.ogg,.oga,.flac,.m4a,.wav,.opus";

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
  // Search-source availability from the backend's own probe; a false entry
  // disables its tab until a later poll says it is back.
  const sourcesQuery = useQuery({
    queryKey: ["system-sources"],
    queryFn: api.sources,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const sourceAvailable = (id: string) => sourcesQuery.data ? sourcesQuery.data[id] !== false : true;

  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [query, setQuery] = useState("");
  const hasQuery = query.trim().length > 0;
  const [searchActive, setSearchActive] = useState(false);
  const [source, setSource] = useState("yt");
  const [results, setResults] = useState<TrackInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [enqueueing, setEnqueueing] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [queueView, setQueueView] = useState<"next" | "recent">("next");
  const [playlist, setPlaylist] = useState<PlaylistPageInfo | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [openPl, setOpenPl] = useState<UserPlaylistFull | null>(null);
  const [newPlName, setNewPlName] = useState("");
  const [plBusy, setPlBusy] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsQuery = useGuildUploads(gid);
  const uploads = uploadsQuery.data ?? [];
  const briefsQuery = useGuilds();
  const canModerateUploads = (() => {
    const brief = briefsQuery.data?.find((g) => g.id === gid);
    return !!brief && (brief.is_admin || !!brief.is_owner);
  })();

  // Player-local section switcher: independent of the global nav collapse.
  const [playerTab, setPlayerTab] = useLocalPrefValue("ui.playerTab", "search");
  const [playerNavCollapsed, setPlayerNavCollapsed] = useLocalPref("ui.playerNavCollapsed", false);
  const activeTab = (PLAYER_TABS.some((t) => t.id === playerTab) ? playerTab : "search") as PlayerTab;

  useEffect(() => {
    const d = sourcesQuery.data;
    if (d && source !== "all" && d[source] === false) {
      setSource("all");
      setResults(null);
    }
  }, [sourcesQuery.data, source]);

  const invalidatePlayer = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["player", gid] });
    void queryClient.invalidateQueries({ queryKey: ["myPlaylists"] });
  }, [gid, queryClient]);

  useEffect(() => {
    if (state && volume === null) setVolume(Math.min(state.volume, 200));
  }, [state, volume]);

  useEffect(() => {
    // A pick from another server is not valid here. The fallback chain
    // mirrors the backend join path: the bot's live channel, then the
    // guild default from settings, then the first channel.
    if (channels.some((c) => c.id === selectedChannel)) return;
    const live = state?.channel_id;
    if (live && channels.some((c) => c.id === live)) {
      setSelectedChannel(live);
      return;
    }
    const def = state?.default_voice_channel_id;
    if (def && channels.some((c) => c.id === def)) {
      setSelectedChannel(def);
      return;
    }
    setSelectedChannel(channels[0]?.id ?? "");
  }, [channels, selectedChannel, state]);

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

  const doSearch = (q: string = query, src: string = source) => {
    if (!q.trim()) return;
    setSearching(true);
    api
      .search(gid, q, src)
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
          setPlayerTab("collection");
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

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length || uploading !== null) return;
    try {
      let last: string | null = null;
      for (const f of Array.from(files)) {
        setUploading(f.name);
        const row = await api.uploadTrack(gid, f);
        last = row.name;
      }
      if (last) {
        feedback.show(`Uploaded: ${last}`);
        void uploadsQuery.refetch();
        setSource("local");
        setQuery("");
        setResults(null);
        doSearch("", "local");
      }
    } catch (e) {
      guard(e as Error);
    } finally {
      setUploading(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const queueUpload = (key: string, path: string, title: string) =>
    enqueue(key, { query: path, source: "local", title });

  const removeUpload = (path: string) => {
    api
      .deleteUpload(gid, path)
      .then(() => {
        void uploadsQuery.refetch();
        feedback.show("Upload deleted");
      })
      .catch(guard);
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

  const stateError = stateQuery.isError ? (stateQuery.error as Error).message : null;

  const dock = state && (
    <PlayerDock
      state={state}
      volume={volume ?? 100}
      onVolumeChange={setVolume}
      onVolumeCommit={(v) => act(() => api.volume(gid, v))}
      onPauseToggle={() => act(() => api.simpleAction(gid, state.current?.paused ? "resume" : "pause"))}
      onPrevious={() => act(() => api.simpleAction(gid, "previous"))}
      onSkip={() => act(() => api.simpleAction(gid, "skip"))}
      onStop={() => act(() => api.simpleAction(gid, "stop"))}
      onSeek={(p) => act(() => api.seek(gid, p))}
      onRepeatCycle={cycleRepeat}
    />
  );

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
                renderValue={(value) => {
                  const channel = channels.find((c) => c.id === value);
                  return (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <MsIcon name="volume_up" fontSize={20} sx={{ color: "text.secondary" }} />
                      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {channel?.name ?? ""}
                      </Box>
                    </Box>
                  );
                }}
              >
                {channels.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    <ListItemText
                      primary={c.name}
                      secondary={c.user_limit ? `${c.user_limit} max` : undefined}
                      slotProps={{ secondary: { variant: "caption" } }}
                    />
                  </MenuItem>
                ))}
              </Select>
              <Button
                variant="contained"
                disabled={!selectedChannel}
                onClick={() =>
                  act(() => api.join(gid, selectedChannel), `Joined ${channels.find((c) => c.id === selectedChannel)?.name ?? "the channel"}`)
                }
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
        <CardContent sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }}>
              Queue ({state?.queue.length ?? 0})
            </Typography>
            {state && (state.queue.length > 0 || state.current) && (
              <Tooltip title="Stop and clear the queue">
                <IconButton
                  size="small"
                  onClick={() => act(() => api.clearQueue(gid), "Queue cleared")}
                  aria-label="Clear queue"
                >
                  <MsIcon name="stop_circle" fontSize={20} sx={{ color: "error.main" }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: "center" }}>
            <Button
              size="small"
              variant={queueView === "next" ? "tonal" : "text"}
              onClick={() => setQueueView("next")}
            >
              Up next
            </Button>
            <Button
              size="small"
              variant={queueView === "recent" ? "tonal" : "text"}
              onClick={() => setQueueView("recent")}
            >
              Recent
            </Button>
            {queueView === "next" && (state?.queue.length ?? 0) > 1 && (
              <Tooltip title="Shuffle the queue">
                <IconButton size="small" onClick={() => act(() => api.shuffleQueue(gid), "Queue shuffled")} sx={{ ml: "auto" }}>
                  <Shuffle fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {queueView === "next" ? (
              state && state.queue.length > 0 ? (
                <List disablePadding>
                  {state.queue.map((t, i) =>
                    t.source === "playlist" ? (
                      <ListItem
                        key={`p${i}`}
                        disableGutters
                        dense
                        onClick={() =>
                          playlistAction(() => api.expandQueuedPlaylist(gid, i), "Playlist tracks loaded")
                        }
                        sx={{
                          cursor: "pointer",
                          borderRadius: 1,
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      >
                        <ListItemAvatar sx={{ minWidth: 36 }}>
                          <KeyboardArrowDown fontSize="small" sx={{ color: "text.secondary" }} />
                        </ListItemAvatar>
                        <ListItemText
                          primary={t.title}
                          secondary="Playlist - click to load tracks"
                          slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                        />
                      </ListItem>
                    ) : (
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
                          bgcolor: dragOverIndex === i ? "action.hover" : undefined,
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                        secondaryAction={
                          <Stack direction="row" spacing={0.5}>
                            <PlaylistAddMenu
                              track={{
                                title: t.title,
                                author: t.author,
                                uri: t.uri ?? "",
                                source: t.source,
                                length_ms: t.length,
                                artwork: t.artwork,
                              }}
                            />
                            <Tooltip title="Move up">
                              <span>
                                <IconButton
                                  size="small"
                                  disabled={i === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    act(() => api.moveQueued(gid, i, i - 1));
                                  }}
                                >
                                  <KeyboardArrowUp fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title="Remove">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  act(() => api.removeQueued(gid, i));
                                }}
                              >
                                <DeleteOutlined fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        }
                      >
                        <ListItemAvatar sx={{ minWidth: 28 }}>
                          <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
                            {i + 1}
                          </Typography>
                        </ListItemAvatar>
                        <ListItemText
                          primary={t.title}
                          secondary={[
                            SOURCE_LABELS[t.source ?? ""] ?? "",
                            t.requested_by,
                            t.length > 0 ? fmt(t.length) : t.source === "local" ? "file" : "LIVE",
                          ].filter(Boolean).join(" · ")}
                          slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                        />
                      </ListItem>
                    ),
                  )}
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
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                    secondaryAction={
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Tooltip title="Add to queue">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`);
                            }}
                          >
                            <PlaylistAdd fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Play now">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`);
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
                      slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
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

  const searchBarProps = {
    gid, source, setSource, query, setQuery, hasQuery, searchActive, setSearchActive,
    setResults, setSearching, searching, enqueueing, enqueue, doSearch: () => doSearch(),
    sourceAvailable, uploading, fileInputRef, uploadFiles,
    onPreset: (preset: string) => {
      setQuery(preset);
      doSearch(preset, "radio");
    },
    guard, SOURCES, PLACEHOLDERS, RADIO_PRESETS, UPLOAD_ACCEPT,
  };

  const enqueueFavorite = (f: { uri: string; source: string; title: string; author: string; length_ms: number; artwork: string | null }) =>
    enqueue(`f${f.uri}`, {
      query: f.uri,
      source: f.source || "yt",
      title: f.title,
      author: f.author,
      length_ms: f.length_ms,
      artwork: f.artwork,
    });

  return (
    <AppShell
      me={me}
      back
      title={state?.guild_name ?? undefined}
      right={rightPanel}
      rightBadge={state?.queue.length ?? 0}
      dock={dock}
    >
      {stateError && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
          Player status is unavailable: {stateError}
        </Typography>
      )}
      <Box sx={{ display: "flex", alignItems: "flex-start" }}>
        {/* The player-local sidebar: hidden on phones, an icon row there. */}
        <Box sx={{ display: { xs: "none", sm: "block" }, position: "sticky", top: 8 }}>
          <PlayerNav
            tab={activeTab}
            onTab={setPlayerTab}
            collapsed={playerNavCollapsed}
            onToggle={() => setPlayerNavCollapsed(!playerNavCollapsed)}
            queueLength={state?.queue.length ?? 0}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Phones: the sections collapse into an icon chip row on top. */}
          <Stack
            direction="row"
            spacing={1}
            sx={{ display: { xs: "flex", sm: "none" }, px: 1.5, pt: 1, overflowX: "auto" }}
          >
            {PLAYER_TABS.map((t) => (
              <Chip
                key={t.id}
                label={t.label}
                color={activeTab === t.id ? "primary" : "default"}
                variant={activeTab === t.id ? "filled" : "outlined"}
                onClick={() => setPlayerTab(t.id)}
                sx={{ flexShrink: 0 }}
              />
            ))}
          </Stack>

          {activeTab === "search" && (
            <>
              <SearchBar {...searchBarProps} />
              <Box sx={{ px: { xs: 1.5, md: 3 }, pb: 3 }}>
                {hasQuery || results ? (
                  <SearchResults
                    results={results}
                    searching={searching}
                    favorites={favorites}
                    toggleFavorite={toggleFavorite}
                    enqueue={enqueue}
                    enqueueing={enqueueing}
                  />
                ) : (
                  <>
                    {favorites.length > 0 && (
                      <HomeRail title="Liked tracks">
                        {favorites.slice(0, 20).map((f) => (
                          <MediaCard
                            key={f.id}
                            title={f.title}
                            subtitle={[SOURCE_LABELS[f.source] ?? "", f.author].filter(Boolean).join(" · ")}
                            artwork={f.artwork}
                            onClick={() =>
                              enqueueFavorite({
                                uri: f.uri, source: f.source || "yt", title: f.title,
                                author: f.author, length_ms: f.length_ms, artwork: f.artwork,
                              })
                            }
                          />
                        ))}
                      </HomeRail>
                    )}
                    <HomeRail title="My playlists">
                      {myPls.map((p) => (
                        <MediaCard
                          key={p.id}
                          title={p.name}
                          subtitle={`${p.tracks} track(s)`}
                          onClick={() => {
                            openPlaylistTracks(p.id);
                            setPlayerTab("collection");
                          }}
                        />
                      ))}
                    </HomeRail>
                    {state && state.played.length > 0 && (
                      <HomeRail title="Recently played">
                        {state.played.slice(0, 20).map((t, i) => (
                          <MediaCard
                            key={`r${i}`}
                            title={t.title}
                            subtitle={[SOURCE_LABELS[t.source ?? ""] ?? "", t.requested_by].filter(Boolean).join(" · ")}
                            onClick={() => act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`)}
                          />
                        ))}
                      </HomeRail>
                    )}
                  </>
                )}
              </Box>
            </>
          )}

          {activeTab === "collection" && (
            <CollectionTab
              gid={gid}
              me={me}
              favorites={favorites}
              onPlayFavorite={enqueueFavorite}
              onRemoveFavorite={(id) =>
                api.removeFavorite(id).then(() => queryClient.invalidateQueries({ queryKey: ["favorites"] })).catch(guard)
              }
              myPls={myPls}
              openPl={openPl}
              onClosePlaylist={() => setOpenPl(null)}
              newPlName={newPlName}
              setNewPlName={setNewPlName}
              createPlaylist={createPlaylist}
              plBusy={plBusy}
              openPlaylistTracks={openPlaylistTracks}
              onShufflePlay={(pid, name) => act(() => api.queueUserPlaylist(gid, pid, true), `Queued "${name}" (shuffled)`)}
              onDeletePlaylist={(pid, name) => plAction(() => api.deleteUserPlaylist(pid), `Playlist "${name}" deleted`, loadMyPls)}
              onQueueAll={() =>
                openPl &&
                plAction(() => api.queueUserPlaylist(gid, openPl.id), `Queued ${openPl.tracks.length} track(s)`)
              }
              onPlayPlaylistTrack={(index, title) =>
                openPl && plAction(() => api.playUserPlaylistTrack(gid, openPl.id, index), `Now playing: ${title}`)
              }
              onRemovePlaylistTrack={(trackId) =>
                openPl &&
                plAction(async () => {
                  await api.removeUserPlaylistTrack(openPl.id, trackId);
                  setOpenPl(await api.userPlaylist(openPl.id));
                })
              }
              uploads={uploads}
              canModerateUploads={canModerateUploads}
              queueUpload={queueUpload}
              removeUpload={removeUpload}
              enqueueing={enqueueing}
              playlist={playlist}
              playlistBusy={playlistBusy}
              onCloseBrowser={() => setPlaylist(null)}
              onReloadBrowser={(page, q) => openPl || playlist ? openPlaylistPage((openPl ?? playlist)!.id, page, q) : undefined}
              onBrowserPlay={(index) => playlist && playlistAction(() => api.playlistPlay(gid, playlist.id, index), "Playing from playlist")}
              onBrowserAdd={(indices) =>
                playlist && playlistAction(() => api.playlistAdd(gid, playlist.id, indices), `Added ${indices.length} track(s) to the queue`)
              }
              onBrowserAddAll={() => playlist && playlistAction(() => api.playlistAddAll(gid, playlist.id), "Whole playlist queued (lazy)")}
            />
          )}

          {activeTab === "history" && (
            <HistoryTab
              played={state?.played ?? []}
              hoveredRow={hoveredRow}
              setHoveredRow={setHoveredRow}
              onReplay={(i, title) => act(() => api.replayPlayed(gid, i), `Now playing: ${title}`)}
              onRequeue={(i, title) => act(() => api.requeuePlayed(gid, i), `Added to queue: ${title}`)}
            />
          )}
        </Box>
      </Box>

      {feedback.node}
    </AppShell>
  );
}
