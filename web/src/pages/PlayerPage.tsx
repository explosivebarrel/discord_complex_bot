import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
  IconFavorite as Favorite,
  IconFolder as Folder,
  IconGraphicEq as GraphicEq,
  IconKeyboardArrowDown as KeyboardArrowDown,
  IconKeyboardArrowUp as KeyboardArrowUp,
  IconLibraryMusic as LibraryMusic,
  IconMusicNote as MusicNote,
  IconPlayArrow as PlayArrow,
  IconQueueMusic as QueueMusic,
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
import { useTrackMenu, type TrackMenuSpec } from "../components/TrackMenu";
import { useFeedback } from "../components/Feedback";
import { fmt, SOURCE_LABELS } from "../components/player/labels";
import { CoverImg } from "../components/player/CoverImg";
import { PLAYER_TABS, PlayerNav, type PlayerTab } from "../components/player/PlayerNav";
import { RowActions, rowActionsRowSx } from "../components/player/RowActions";
import { HomeRail, MediaCard, SearchBar, SearchResults } from "../components/player/SearchTab";
import { NowPlayingScreen } from "../components/player/NowPlayingScreen";
import { CollectionTab } from "../components/player/CollectionTab";
import { HistoryTab } from "../components/player/HistoryTab";
import { usePlayerSocket } from "../usePlayerSocket";
import { useLocalPref } from "../useLocalPref";

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
  const location = useLocation();
  const navigate = useNavigate();
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const queryClient = useQueryClient();

  // Server state lives in the query cache: revisits render instantly while
  // the refresh happens in the background; the player state polls every 3s.
  usePlayerSocket(gid);
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
  // "All" is the default: with the search cache the first slow multi-source
  // query is remembered, so later searches of the same query are instant.
  const [source, setSource] = useState("all");
  const [results, setResults] = useState<TrackInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Sequence guard for search responses: only the newest request may paint.
  const searchSeq = useRef(0);
  const [enqueueing, setEnqueueing] = useState<string | null>(null);
  const [queueView, setQueueView] = useState<"next" | "recent">("next");
  const [playlist, setPlaylist] = useState<PlaylistPageInfo | null>(null);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [openPl, setOpenPl] = useState<UserPlaylistFull | null>(null);
  const [plBusy, setPlBusy] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsQuery = useGuildUploads(gid);
  const uploads = uploadsQuery.data ?? [];
  const briefsQuery = useGuilds();
  const canModerateUploads = (() => {
    const brief = briefsQuery.data?.find((g) => g.id === gid);
    return !!brief && (brief.is_admin || !!brief.is_owner);
  })();

  // Player-local section switcher lives in the URL, so the browser back
  // button and the in-page Back controls both work. Nested views (liked
  // tracks, a playlist page) are deeper segments of the same scheme.
  const basePath = `/guild/${gid}`;
  const collectionPath = `${basePath}/collection`;
  const likedOpen = location.pathname === `${collectionPath}/liked`;
  const plId = Number(location.pathname.match(/^\/guild\/[^/]+\/collection\/playlist\/(\d+)$/)?.[1]) || null;
  const activeTab: PlayerTab = location.pathname.startsWith(collectionPath)
    ? "collection"
    : location.pathname === `${basePath}/history`
      ? "history"
      : "search";
  const setPlayerTab = (t: PlayerTab) =>
    navigate(t === "search" ? basePath : t === "collection" ? collectionPath : `${basePath}/history`);
  const openPlaylistRoute = (pid: number) => navigate(`${collectionPath}/playlist/${pid}`);
  const [playerNavCollapsed, setPlayerNavCollapsed] = useLocalPref("ui.playerNavCollapsed", false);

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

  // Right-click menu state shared by every track list on the page.
  const trackMenu = useTrackMenu();
  // Build a context-menu spec for a track-ish row: standard items (favorite)
  // plus the caller's play/queue handlers and context extras.
  const trackMenuSpec = (
    t: { title: string; author?: string | null; uri?: string | null; source?: string | null; length?: number; artwork?: string | null },
    opts: Partial<Pick<TrackMenuSpec, "onPlay" | "onQueue" | "extra">> = {},
  ): TrackMenuSpec => ({
    track: {
      title: t.title,
      author: t.author,
      uri: t.uri ?? "",
      source: t.source ?? "",
      length_ms: t.length ?? 0,
      artwork: t.artwork ?? null,
    },
    favorite: favorites.some((f) => f.uri === (t.uri ?? "")),
    onToggleFavorite: () => toggleFavorite(t as TrackInfo),
    ...opts,
  });

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
    // A slow response must never overwrite a newer search's results.
    const seq = ++searchSeq.current;
    setSearching(true);
    api
      .search(gid, q, src)
      .then((r) => {
        if (searchSeq.current !== seq) return;
        setResults(r.results);
        if (r.cache !== "stale") {
          setSearching(false);
          return;
        }
        // Stale cache is already on screen: refresh it in the background
        // (the banner explains the swap) and replace when done. On failure
        // the cached results simply stay.
        api
          .search(gid, q, src, true)
          .then((r2) => {
            if (searchSeq.current === seq) setResults(r2.results);
          })
          .catch(() => {})
          .finally(() => {
            if (searchSeq.current === seq) setSearching(false);
          });
      })
      .catch((e) => {
        if (searchSeq.current === seq) {
          guard(e);
          setSearching(false);
        }
      });
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

  const createPlaylist = (name: string) => {
    if (!name.trim() || plBusy) return;
    plAction(
      async () => {
        await api.createUserPlaylist(name.trim());
        await loadMyPls();
      },
      `Playlist "${name.trim()}" created`,
    );
  };

  // A playlist route loads its full contents; leaving the route clears it.
  useEffect(() => {
    if (plId === null) {
      setOpenPl(null);
      return;
    }
    if (openPl?.id === plId) return;
    let alive = true;
    setPlBusy(true);
    api
      .userPlaylist(plId)
      .then((p) => {
        if (alive) setOpenPl(p);
      })
      .catch((e) => {
        guard(e as Error);
        navigate(collectionPath);
      })
      .finally(() => {
        if (alive) setPlBusy(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plId]);

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
      onOpenNowPlaying={state?.current ? () => setNowPlayingOpen(true) : undefined}
      favorite={!!state?.current && favorites.some((f) => f.uri === state.current?.uri)}
      onToggleFavorite={state?.current ? () => toggleFavorite(state.current as TrackInfo) : undefined}
      playlistMenu={
        state?.current ? (
          <PlaylistAddMenu
            size="medium"
            track={{
              title: state.current.title,
              author: state.current.author,
              uri: state.current.uri ?? "",
              source: state.current.source ?? "",
              length_ms: state.current.length,
              artwork: state.current.artwork,
            }}
          />
        ) : null
      }
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
                        onContextMenu={(e) =>
                          trackMenu.open(
                            e,
                            trackMenuSpec(t, {
                              onPlay: () => act(() => api.jumpQueued(gid, i), `Now playing: ${t.title}`),
                              extra: [
                                ...(i > 0
                                  ? [{ key: "up", label: "Move up", icon: "arrow_upward", onClick: () => act(() => api.moveQueued(gid, i, i - 1)) }]
                                  : []),
                                ...(i < (state?.queue.length ?? 0) - 1
                                  ? [{ key: "down", label: "Move down", icon: "arrow_downward", onClick: () => act(() => api.moveQueued(gid, i, i + 1)) }]
                                  : []),
                                { key: "rm", label: "Remove from queue", icon: "delete", danger: true, onClick: () => act(() => api.removeQueued(gid, i)) },
                              ],
                            }),
                          )
                        }
                        sx={{
                          cursor: "pointer",
                          borderRadius: 1,
                          px: 1.5,
                          gap: 1.5,
                          bgcolor: dragOverIndex === i ? "action.hover" : undefined,
                          "&:hover": { bgcolor: "action.hover" },
                          ...rowActionsRowSx,
                        }}
                        secondaryAction={
                          <RowActions>
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
                            <Tooltip title={favorites.some((f) => f.uri === t.uri) ? "Remove from favorites" : "Add to favorites"}>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleFavorite(t);
                                }}
                              >
                                <Favorite
                                  filled={favorites.some((f) => f.uri === t.uri)}
                                  fontSize="small"
                                />
                              </IconButton>
                            </Tooltip>
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
                          </RowActions>
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
                  onClick={() => act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`)}
                  onContextMenu={(e) =>
                      trackMenu.open(
                        e,
                        trackMenuSpec(t, {
                          onPlay: () => act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`),
                          onQueue: () => act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`),
                        }),
                      )
                    }
                    sx={{
                      cursor: "pointer",
                      borderRadius: 1,
                      px: 1.5,
                      gap: 1.5,
                      "&:hover": { bgcolor: "action.hover" },
                      ...rowActionsRowSx,
                    }}
                    secondaryAction={
                      <RowActions>
                        <Tooltip title="Add to queue">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`);
                            }}
                          >
                            <QueueMusic fontSize="small" />
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
                        <Tooltip title={favorites.some((f) => f.uri === t.uri) ? "Remove from favorites" : "Add to favorites"}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(t);
                            }}
                          >
                            <Favorite filled={favorites.some((f) => f.uri === t.uri)} fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </RowActions>
                    }
                  >
                    <ListItemAvatar sx={{ minWidth: 36 }}>
                      <CoverImg src={t.artwork} size={36} />
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

  const playerNav = (
    <PlayerNav
      tab={activeTab}
      onTab={setPlayerTab}
      collapsed={playerNavCollapsed}
      onToggle={() => setPlayerNavCollapsed(!playerNavCollapsed)}
    />
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
      leftNav={playerNav}
    >
      {stateError && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
          Player status is unavailable: {stateError}
        </Typography>
      )}
      <Box>
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
                    onMenu={trackMenu.open}
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
                            onMenu={(e) =>
                              trackMenu.open(e, {
                                track: {
                                  title: f.title, author: f.author, uri: f.uri,
                                  source: f.source, length_ms: f.length_ms, artwork: f.artwork,
                                },
                                favorite: true,
                                onToggleFavorite: () =>
                                  api.removeFavorite(f.id).then(() => queryClient.invalidateQueries({ queryKey: ["favorites"] })).catch(guard),
                                onQueue: () =>
                                  enqueueFavorite({
                                    uri: f.uri, source: f.source || "yt", title: f.title,
                                    author: f.author, length_ms: f.length_ms, artwork: f.artwork,
                                  }),
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
                          artworks={p.artworks}
                          onClick={() => openPlaylistRoute(p.id)}
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
                            artwork={t.artwork}
                            // Click adds to the queue; play stays on the hover
                            // badges and the context menu.
                            onClick={() => act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`)}
                            onQueue={() => act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`)}
                            onMenu={(e) =>
                              trackMenu.open(
                                e,
                                trackMenuSpec(t, {
                                  onPlay: () => act(() => api.replayPlayed(gid, i), `Now playing: ${t.title}`),
                                  onQueue: () => act(() => api.requeuePlayed(gid, i), `Added to queue: ${t.title}`),
                                }),
                              )
                            }
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
              onQueueFavorite={(f) =>
                enqueue(`fq:${f.id}`, {
                  query: f.uri, source: f.source || "yt", title: f.title,
                  author: f.author, length_ms: f.length_ms, artwork: f.artwork,
                })
              }
              onRemoveFavorite={(id) =>
                api.removeFavorite(id).then(() => queryClient.invalidateQueries({ queryKey: ["favorites"] })).catch(guard)
              }
              onMenu={trackMenu.open}
              myPls={myPls}
              likedOpen={likedOpen}
              onOpenLiked={() => navigate(`${collectionPath}/liked`)}
              openPl={openPl}
              plOpening={plId !== null && openPl === null}
              createPlaylist={createPlaylist}
              plBusy={plBusy}
              onOpenPlaylist={openPlaylistRoute}
              onDetailDelete={() =>
                openPl &&
                plAction(
                  () => api.deleteUserPlaylist(openPl.id),
                  `Playlist "${openPl.name}" deleted`,
                  () => navigate(collectionPath),
                )
              }
              onShufflePlay={(pid, name) => act(() => api.queueUserPlaylist(gid, pid, true), `Queued "${name}" (shuffled)`)}
              onPlayPlaylist={(pid, name) => act(() => api.queueUserPlaylist(gid, pid), `Playing "${name}"`)}
              onQueueFavorites={() => act(() => api.queueFavorites(gid), "Favorites queued")}
              onQueueAll={() =>
                openPl &&
                plAction(() => api.queueUserPlaylist(gid, openPl.id), `Queued ${openPl.tracks.length} track(s)`)
              }
              onPlayPlaylistTrack={(index, title) =>
                openPl && plAction(() => api.playUserPlaylistTrack(gid, openPl.id, index), `Now playing: ${title}`)
              }
              onQueuePlaylistTrack={(index, title) =>
                openPl &&
                plAction(() => api.queueUserPlaylistTrack(gid, openPl.id, index), `Added to queue: ${title}`)
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
              favorites={favorites}
              toggleFavorite={toggleFavorite}
              onReplay={(i, title) => act(() => api.replayPlayed(gid, i), `Now playing: ${title}`)}
              onRequeue={(i, title) => act(() => api.requeuePlayed(gid, i), `Added to queue: ${title}`)}
              onMenu={trackMenu.open}
            />
          )}
      </Box>

      {feedback.node}
      {trackMenu.node}
      {nowPlayingOpen && state?.current && (
        <NowPlayingScreen
          state={state}
          favorite={favorites.some((f) => f.uri === state.current?.uri)}
          onToggleFavorite={() => state.current && toggleFavorite(state.current as TrackInfo)}
          onPauseToggle={() => act(() => api.simpleAction(gid, state.current?.paused ? "resume" : "pause"))}
          onPrevious={() => act(() => api.simpleAction(gid, "previous"))}
          onSkip={() => act(() => api.simpleAction(gid, "skip"))}
          onSeek={(p) => act(() => api.seek(gid, p))}
          onRepeatCycle={cycleRepeat}
          onShuffleQueue={() => act(() => api.shuffleQueue(gid), "Queue shuffled")}
          onMenu={(e) =>
            state.current &&
            trackMenu.open(
              e,
              trackMenuSpec(state.current, {
                onPlay: () => act(() => api.simpleAction(gid, state.current?.paused ? "resume" : "pause")),
              }),
            )
          }
          onClose={() => setNowPlayingOpen(false)}
        />
      )}
    </AppShell>
  );
}
