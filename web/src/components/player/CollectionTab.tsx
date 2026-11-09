import { useState } from "react";
import {
  Box, Button, CircularProgress, IconButton, List, ListItem, ListItemAvatar, ListItemText,
  Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  IconDelete as DeleteOutlined,
  IconFavorite as Favorite,
  IconPlayArrow as PlayArrow,
  IconPlaylistAdd as PlaylistAdd,
  IconQueueMusic as QueueMusic,
  IconShuffle as Shuffle,
} from "../icons";
import { MsIcon } from "../MsIcon";
import { PlaylistAddMenu } from "../PlaylistAddMenu";
import { MosaicCover } from "../MosaicCover";
import type { TrackMenuSpec } from "../TrackMenu";
import { CoverImg } from "./CoverImg";
import { RowActions, rowActionsRowSx } from "./RowActions";
import { fmt, SOURCE_LABELS } from "./labels";

export interface CollectionTabProps {
  gid: string;
  me: { discord_id: string } | null;
  favorites: {
    id: number; title: string; author: string; uri: string;
    source: string; length_ms: number; artwork: string | null;
  }[];
  onPlayFavorite: (f: { uri: string; source: string; title: string; author: string; length_ms: number; artwork: string | null }) => void;
  onQueueFavorite: (f: { id: number; uri: string; source: string; title: string; author: string; length_ms: number; artwork: string | null }) => void;
  onRemoveFavorite: (id: number) => void;
  onMenu: (e: React.MouseEvent, spec: TrackMenuSpec) => void;
  myPls: { id: number; name: string; tracks: number; artwork?: string | null; artworks?: string[] }[];
  likedOpen: boolean;
  onOpenLiked: () => void;
  openPl: { id: number; name: string; tracks: { id: number; title: string; author: string; source: string; length_ms: number; artwork?: string | null; uri?: string }[] } | null;
  plOpening: boolean;
  createPlaylist: (name: string) => void;
  onQueueFavorites: () => void;
  plBusy: boolean;
  onShufflePlay: (pid: number, name: string) => void;
  onPlayPlaylist: (pid: number, name: string) => void;
  onOpenPlaylist: (pid: number) => void;
  onDetailDelete: () => void;
  onQueueAll: () => void;
  onPlayPlaylistTrack: (index: number, title: string) => void;
  onQueuePlaylistTrack: (index: number, title: string) => void;
  onRemovePlaylistTrack: (trackId: number) => void;
  uploads: { path: string; name: string; size_mb: number; uploader: string }[];
  canModerateUploads: boolean;
  queueUpload: (key: string, path: string, name: string) => void;
  removeUpload: (path: string) => void;
  enqueueing: string | null;
  playlist: import("../../api").PlaylistPageInfo | null;
  playlistBusy: boolean;
  onCloseBrowser: () => void;
  onBackFromExternal: () => void;
  onReloadBrowser: (page: number, q: string) => void;
  onBrowserPlay: (index: number) => void;
  onBrowserAdd: (indices: number[]) => void;
  onBrowserAddAll: () => void;
  onImport?: (name: string) => void;
}

/** A compact track row (two-column favorite grids, playlist contents):
    cover, title/author, hover actions, duration; the whole row plays. */
function TrackRow({
  title, author, source, lengthMs, artwork, onPlay, actions, onMenu,
}: {
  title: string;
  author: string;
  source: string;
  lengthMs: number;
  artwork: string | null;
  onPlay: () => void;
  actions?: React.ReactNode;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <ListItem
      disableGutters
      dense
      onClick={onPlay}
      onContextMenu={onMenu}
      sx={{
        cursor: "pointer",
        borderRadius: 1,
        px: 1,
        gap: 1.25,
        "&:hover": { bgcolor: "action.hover" },
        ...rowActionsRowSx,
      }}
      secondaryAction={actions}
    >
      <ListItemAvatar sx={{ minWidth: 0, width: 40, height: 40, display: "grid", placeItems: "center" }}>
        <CoverImg src={artwork} size={40} />
      </ListItemAvatar>
      <ListItemText
        primary={title}
        secondary={[SOURCE_LABELS[source] ?? "", author].filter(Boolean).join(" · ")}
        slotProps={{ primary: { noWrap: true, sx: { pr: 2 } }, secondary: { noWrap: true, sx: { pr: 2 } } }}
      />
      {lengthMs > 0 && (
        <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", mr: 6 }}>
          {fmt(lengthMs)}
        </Typography>
      )}
    </ListItem>
  );
}

/** An external playlist (opened via a URL from search) shown as a full
    page in the same style as our own playlist pages: a hero with the
    cover mosaic and the usual actions, then track rows with hover pills. */
function ExternalPlaylistView({
  playlist, busy, onClose, onBack, onReload, onPlay, onAdd, onAddAll, onMenu, onImport,
}: {
  playlist: import("../../api").PlaylistPageInfo;
  busy: boolean;
  onClose: () => void;
  onBack: () => void;
  onReload: (page: number, q: string) => void;
  onPlay: (index: number) => void;
  onAdd: (indices: number[]) => void;
  onAddAll: () => void;
  onMenu: (e: React.MouseEvent, spec: TrackMenuSpec) => void;
  onImport?: (name: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const heroCovers = [...new Set(playlist.tracks.map((t) => t.artwork).filter((x): x is string => !!x))].slice(0, 4);

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 1000 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2, alignItems: { sm: "center" } }}>
        <MosaicCover images={heroCovers} size={120} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>
            Playlist · {SOURCE_LABELS[playlist.source] ?? playlist.source}
          </Typography>
          <Typography variant="h4" noWrap>{playlist.title}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
            {playlist.matched === playlist.total
              ? `${playlist.total} track(s)`
              : `${playlist.matched} of ${playlist.total} tracks`}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Back to the collection">
              <IconButton onClick={onBack} aria-label="Back to the collection">
                <MsIcon name="arrow_back" fontSize={22} />
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              disabled={busy || playlist.tracks.length === 0}
              startIcon={<PlayArrow />}
              onClick={() => onPlay(playlist.tracks[0]?.index ?? 0)}
            >
              Play
            </Button>
            <Tooltip title="Queue the whole playlist (lazy: pages load as the queue advances)">
              <IconButton disabled={busy || playlist.tracks.length === 0} onClick={onAddAll}>
                <PlaylistAdd />
              </IconButton>
            </Tooltip>
            {onImport && (
              <Tooltip title="Copy this playlist into my playlists">
                <Button
                  disabled={busy || playlist.tracks.length === 0}
                  startIcon={<PlaylistAdd />}
                  onClick={() => onImport(playlist.title)}
                >
                  Import
                </Button>
              </Tooltip>
            )}
            <Tooltip title="Close">
              {/* A fixed square: the row stretches children, and a stretched
                  small IconButton turns borderRadius:50% into an oval. */}
              <IconButton
                onClick={onClose}
                aria-label="Close external playlist"
                sx={{ width: 40, height: 40, flexShrink: 0, alignSelf: "center", borderRadius: "50%" }}
              >
                <DeleteOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search inside the playlist"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onReload(0, filter)}
        />
        <Button variant="tonal" disabled={busy} onClick={() => onReload(0, filter)}>
          Find
        </Button>
      </Stack>

      <List disablePadding>
        {playlist.tracks.map((t) => (
          <ListItem
            key={t.index}
            disableGutters
            dense
            // Row click adds to the queue, like everywhere else.
            onClick={() => onAdd([t.index])}
            sx={{
              cursor: "pointer",
              borderRadius: 1,
              alignItems: "center",
              gap: 1.25,
              px: 1.5,
              py: 0.75,
              "& .MuiListItemText-root": { my: 0 },
              "&:hover": { bgcolor: "action.hover" },
              ...rowActionsRowSx,
            }}
            onContextMenu={(e) =>
              onMenu(e, {
                track: {
                  title: t.title,
                  author: t.author,
                  uri: t.uri ?? "",
                  source: playlist.source,
                  length_ms: t.length,
                  artwork: t.artwork,
                },
                onPlay: () => onPlay(t.index),
                onQueue: () => onAdd([t.index]),
              })
            }
            secondaryAction={
              <RowActions>
                <Tooltip title="Play now">
                  <IconButton
                    size="small"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(t.index);
                    }}
                    aria-label="Play now"
                  >
                    <PlayArrow fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Add to queue">
                  <IconButton
                    size="small"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd([t.index]);
                    }}
                    aria-label="Add to queue"
                  >
                    <QueueMusic fontSize="small" />
                  </IconButton>
                </Tooltip>
                <PlaylistAddMenu
                  track={{
                    title: t.title,
                    author: t.author,
                    uri: t.uri ?? "",
                    source: playlist.source,
                    length_ms: t.length,
                    artwork: t.artwork,
                  }}
                />
              </RowActions>
            }
          >
            <ListItemAvatar sx={{ minWidth: 0, width: 40, height: 40, display: "grid", placeItems: "center" }}>
              <CoverImg src={t.artwork} size={40} />
            </ListItemAvatar>
            <ListItemText
              primary={t.title}
              secondary={[t.author || "", t.length > 0 ? fmt(t.length) : "LIVE"].filter(Boolean).join(" · ")}
              slotProps={{ primary: { noWrap: true, sx: { pr: 2 } }, secondary: { noWrap: true, sx: { pr: 2 } } }}
            />
          </ListItem>
        ))}
        {playlist.tracks.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", py: 2, textAlign: "center" }}>
            Nothing matches the filter.
          </Typography>
        )}
      </List>

      {playlist.pages > 1 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: "center", justifyContent: "center" }}>
          <Button size="small" variant="tonal" disabled={playlist.page <= 0 || busy} onClick={() => onReload(playlist.page - 1, filter)}>
            Prev
          </Button>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {playlist.page + 1} / {playlist.pages}
          </Typography>
          <Button size="small" variant="tonal" disabled={playlist.page >= playlist.pages - 1 || busy} onClick={() => onReload(playlist.page + 1, filter)}>
            Next
          </Button>
        </Stack>
      )}
    </Box>
  );
}

/** The player Collection tab, Yandex-Music style: a liked-tracks block
    (hero + two-column preview), playlist cards with an inline "new
    playlist" tile, uploads, and a full playlist page with a hero. The
    liked page and playlist pages are URL routes: Back returns to the
    previous view. */
export function CollectionTab(props: CollectionTabProps) {
  const {
    me, favorites, onQueueFavorite, onRemoveFavorite, onMenu, myPls, likedOpen, onOpenLiked,
    openPl, plOpening, createPlaylist, plBusy, onShufflePlay, onPlayPlaylist, onOpenPlaylist, onDetailDelete, onBackFromExternal,
    onQueueAll, onPlayPlaylistTrack, onQueuePlaylistTrack, onRemovePlaylistTrack, onQueueFavorites,
    uploads, canModerateUploads, queueUpload, removeUpload, enqueueing, playlist, playlistBusy, onCloseBrowser,
    onReloadBrowser, onBrowserPlay, onBrowserAdd, onBrowserAddAll, onImport,
  } = props;
  const [newPlOpen, setNewPlOpen] = useState(false);
  const [newPlName, setNewPlName] = useState("");
  const [plFilter, setPlFilter] = useState("");

  const favRow = (f: CollectionTabProps["favorites"][number]) => (
    <TrackRow
      key={f.id}
      title={f.title}
      author={f.author}
      source={f.source}
      lengthMs={f.length_ms}
      artwork={f.artwork}
      onPlay={() => onQueueFavorite(f)}
      onMenu={(e) =>
        onMenu(e, {
          track: {
            title: f.title, author: f.author, uri: f.uri,
            source: f.source, length_ms: f.length_ms, artwork: f.artwork,
          },
          favorite: true,
          onToggleFavorite: () => onRemoveFavorite(f.id),
          onQueue: () => onQueueFavorite(f),
        })
      }
      actions={
        <RowActions>
          <Tooltip title="Add to queue">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onQueueFavorite(f);
              }}
            >
              <QueueMusic fontSize="small" />
            </IconButton>
          </Tooltip>
          <PlaylistAddMenu
            track={{
              title: f.title, author: f.author, uri: f.uri,
              source: f.source, length_ms: f.length_ms, artwork: f.artwork,
            }}
          />
          <Tooltip title="Remove from favorites">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFavorite(f.id);
              }}
            >
              <Favorite filled fontSize="small" />
            </IconButton>
          </Tooltip>
        </RowActions>
      }
    />
  );

  if (plOpening) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  // ---- Full liked-tracks page (its own route) ----
  if (likedOpen) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 1000 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2, alignItems: { sm: "center" } }}>
          <Box
            sx={(t) => ({
              width: 120, height: 120, borderRadius: "12px",
              bgcolor: t.palette.m3.primaryContainer, display: "grid", placeItems: "center",
            })}
          >
            <Favorite sx={{ fontSize: 56, color: (tt) => tt.palette.m3.onPrimaryContainer }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: "text.secondary" }}>Collection</Typography>
            <Typography variant="h4">Liked tracks</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
              {favorites.length} track(s)
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={plBusy || favorites.length === 0}
                startIcon={<PlayArrow />}
                onClick={onQueueFavorites}
              >
                Play
              </Button>
            </Stack>
          </Box>
        </Stack>
        <List disablePadding>
          {favorites.map((f) => favRow(f))}
        </List>
      </Box>
    );
  }

  // ---- External playlist page (opened via a URL; full-page style) ----
  if (playlist) {
    return (
      <ExternalPlaylistView
        playlist={playlist}
        busy={playlistBusy}
        onClose={onCloseBrowser}
        onBack={onBackFromExternal}
        onReload={onReloadBrowser}
        onPlay={onBrowserPlay}
        onAdd={onBrowserAdd}
        onAddAll={onBrowserAddAll}
        onMenu={onMenu}
        onImport={onImport}
      />
    );
  }

  // ---- Full playlist page (its own route) ----
  if (openPl) {
    // Hero mosaic: first 4 track covers, duplicates skipped.
    const heroCovers = [...new Set(openPl.tracks.map((t) => t.artwork).filter((x): x is string => !!x))].slice(0, 4);
    const visible = openPl.tracks.filter((t) =>
      !plFilter.trim() || t.title.toLowerCase().includes(plFilter.trim().toLowerCase()));
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 1000 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2, alignItems: { sm: "center" } }}>
          <MosaicCover images={heroCovers} size={120} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: "text.secondary" }}>Playlist</Typography>
            <Typography variant="h4" noWrap>{openPl.name}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
              {openPl.tracks.length} track(s)
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={plBusy || openPl.tracks.length === 0}
                startIcon={<PlayArrow />}
                onClick={() => onPlayPlaylistTrack(0, openPl.tracks[0]?.title ?? "")}
              >
                Play
              </Button>
              <Tooltip title="Queue the whole playlist in random order">
                <IconButton disabled={plBusy || openPl.tracks.length === 0} onClick={() => onShufflePlay(openPl.id, openPl.name)}>
                  <Shuffle />
                </IconButton>
              </Tooltip>
              <Tooltip title="Queue all">
                <IconButton disabled={plBusy || openPl.tracks.length === 0} onClick={onQueueAll}>
                  <PlaylistAdd />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete playlist">
                <IconButton size="small" disabled={plBusy} onClick={onDetailDelete}>
                  <DeleteOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>
        </Stack>
        <TextField
          fullWidth
          size="small"
          placeholder="Search track"
          value={plFilter}
          onChange={(e) => setPlFilter(e.target.value)}
          sx={{ mb: 1.5 }}
        />
        <List disablePadding>
          {visible.map((t) => {
            const index = openPl.tracks.indexOf(t);
            return (
              <TrackRow
                key={t.id}
                title={t.title}
                author={t.author}
                source={t.source}
                lengthMs={t.length_ms}
                artwork={t.artwork ?? null}
                onPlay={() => onQueuePlaylistTrack(index, t.title)}
                onMenu={(e) =>
                  onMenu(e, {
                    track: {
                      title: t.title, author: t.author, uri: t.uri ?? "",
                      source: t.source, length_ms: t.length_ms, artwork: t.artwork ?? null,
                    },
                    onPlay: () => onPlayPlaylistTrack(index, t.title),
                    onQueue: () => onQueuePlaylistTrack(index, t.title),
                    extra: [
                      {
                        key: "rm",
                        label: "Remove from playlist",
                        icon: "delete",
                        danger: true,
                        onClick: () => onRemovePlaylistTrack(t.id),
                      },
                    ],
                  })
                }
                actions={
                  <RowActions>
                    <Tooltip title="Add to queue">
                      <IconButton
                        size="small"
                        disabled={plBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onQueuePlaylistTrack(index, t.title);
                        }}
                      >
                        <QueueMusic fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <PlaylistAddMenu
                      track={{
                        title: t.title, author: t.author, uri: t.uri ?? "",
                        source: t.source, length_ms: t.length_ms, artwork: t.artwork ?? null,
                      }}
                    />
                    <Tooltip title="Remove from playlist">
                      <IconButton
                        size="small"
                        disabled={plBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemovePlaylistTrack(t.id);
                        }}
                      >
                        <DeleteOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </RowActions>
                }
              />
            );
          })}
          {visible.length === 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Nothing matches this filter.
            </Typography>
          )}
        </List>
      </Box>
    );
  }

  // ---- Favorites block: hero + two-column preview ----
  const favPreview = favorites.slice(0, 8);
  const leftCol = favPreview.filter((_, i) => i % 2 === 0);
  const rightCol = favPreview.filter((_, i) => i % 2 === 1);

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 1000 }}>
      <Typography variant="h4" sx={{ fontWeight: 500, mb: 2 }}>Collection</Typography>

      {/* Liked tracks: hero + two-column preview of the first tracks. */}
      <Box sx={{ mb: 4 }}>
        <Stack
          direction="row"
          spacing={2}
          onClick={onOpenLiked}
          sx={{ alignItems: "center", mb: 1.5, cursor: "pointer" }}
        >
          <Box
            sx={(t) => ({
              width: 84, height: 84, borderRadius: "12px",
              bgcolor: t.palette.m3.primaryContainer, display: "grid", placeItems: "center",
            })}
          >
            <Favorite sx={{ fontSize: 40, color: (tt) => tt.palette.m3.onPrimaryContainer }} />
          </Box>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 500 }}>Liked tracks</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {favorites.length} track(s)
            </Typography>
          </Box>
        </Stack>
        {favorites.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Nothing here yet. Tap the heart on any search result.
          </Typography>
        ) : (
          // Flex-wrap instead of a fixed grid: each column keeps its share
          // when there is room and the second wraps below when the content
          // column is squeezed (sidebars open), so no horizontal scroll.
          <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 3, minWidth: 0 }}>
            <List disablePadding sx={{ flex: "1 1 360px", minWidth: 0 }}>
              {leftCol.map(favRow)}
            </List>
            <List disablePadding sx={{ flex: "1 1 360px", minWidth: 0 }}>
              {rightCol.map(favRow)}
            </List>
          </Box>
        )}
      </Box>

      {/* Playlists: creation tile + cards. */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ fontWeight: 500, mb: 1.25 }}>My playlists</Typography>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ overflowX: "auto", pb: 1 }}>
          <Box sx={{ width: 148, flexShrink: 0 }}>
            <Box
              onClick={() => setNewPlOpen(true)}
              sx={(t) => ({
                width: 148, height: 148, borderRadius: "12px",
                bgcolor: t.palette.m3.surfaceContainerHigh,
                display: "grid", placeItems: "center", cursor: "pointer",
                "&:hover": { bgcolor: t.palette.m3.surfaceContainerHighest },
              })}
            >
              <MsIcon name="add" fontSize={36} sx={{ color: "text.secondary" }} />
            </Box>
            <Typography variant="body2" noWrap sx={{ mt: 0.75, color: "text.secondary" }}>New playlist</Typography>
            {newPlOpen && (
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                <TextField
                  autoFocus
                  size="small"
                  placeholder="Name"
                  value={newPlName}
                  onChange={(e) => setNewPlName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPlName.trim()) { createPlaylist(newPlName); setNewPlOpen(false); }
                    if (e.key === "Escape") setNewPlOpen(false);
                  }}
                />
                <Button size="small" variant="tonal" disabled={!newPlName.trim() || plBusy} onClick={() => { createPlaylist(newPlName); setNewPlOpen(false); }}>
                  Create
                </Button>
              </Stack>
            )}
          </Box>
          {myPls.map((p) => (
            <Box key={p.id} sx={{ width: 148, flexShrink: 0 }}>
              <Box
                onClick={() => onOpenPlaylist(p.id)}
                sx={{ position: "relative", cursor: "pointer", "&:hover .card-play": { opacity: 1 } }}
              >
                <MosaicCover images={p.artworks ?? (p.artwork ? [p.artwork] : [])} size={148} />
                <Stack direction="row" spacing={0.5} sx={{ position: "absolute", right: 6, bottom: 6 }}>
                  <Tooltip title="Play from the start">
                    <IconButton
                      size="small"
                      className="card-play"
                      disabled={plBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayPlaylist(p.id, p.name);
                      }}
                      sx={(t) => ({
                        opacity: 0,
                        bgcolor: t.palette.primary.main,
                        "&:hover": { bgcolor: t.palette.primary.main },
                      })}
                    >
                      <PlayArrow fontSize="small" sx={{ color: (tt) => tt.palette.m3.onPrimary }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Shuffle play">
                    <IconButton
                      size="small"
                      className="card-play"
                      disabled={plBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShufflePlay(p.id, p.name);
                      }}
                      sx={(t) => ({
                        opacity: 0,
                        bgcolor: t.palette.primary.main,
                        "&:hover": { bgcolor: t.palette.primary.main },
                      })}
                    >
                      <Shuffle fontSize="small" sx={{ color: (tt) => tt.palette.m3.onPrimary }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
              <Typography variant="body2" noWrap onClick={() => onOpenPlaylist(p.id)} sx={{ mt: 0.75, cursor: "pointer" }}>
                {p.name}
              </Typography>
              <Typography variant="caption" noWrap onClick={() => onOpenPlaylist(p.id)} sx={{ color: "text.secondary", display: "block", cursor: "pointer" }}>
                {p.tracks} track(s)
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="h6" sx={{ fontWeight: 500, mb: 1.25 }}>My uploads</Typography>
        {uploads.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No uploads yet. Use Upload audio in the search to add your own
            files — they are searchable under Local.
          </Typography>
        ) : (
          <List disablePadding>
            {uploads.map((u) => {
              const mine = u.uploader === me?.discord_id;
              return (
                <ListItem
                  key={u.path}
                  disableGutters
                  onClick={() => queueUpload(`up:${u.path}`, u.path, u.name)}
                  onContextMenu={(e) =>
                    onMenu(e, {
                      track: { title: u.name, uri: u.path, source: "local", artwork: null, length_ms: 0 },
                      onQueue: () => queueUpload(`up:${u.path}`, u.path, u.name),
                      extra: [
                        {
                          key: "rm",
                          label: mine ? "Delete upload" : "Delete (admin)",
                          icon: "delete",
                          danger: true,
                          onClick: () => removeUpload(u.path),
                        },
                      ],
                    })
                  }
                  sx={{
                    cursor: "pointer",
                    borderRadius: 1,
                    "&:hover": { bgcolor: "action.hover" },
                    ...rowActionsRowSx,
                  }}
                  secondaryAction={
                    <RowActions>
                      <Tooltip title="Queue">
                        <IconButton
                          edge="end"
                          aria-label={`Queue ${u.name}`}
                          disabled={enqueueing !== null}
                          onClick={() => queueUpload(`up:${u.path}`, u.path, u.name)}
                        >
                          <QueueMusic fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={mine ? "Delete upload" : "Delete (admin)"}>
                        <span>
                          <IconButton
                            aria-label={`Delete ${u.name}`}
                            disabled={!mine && !canModerateUploads}
                            onClick={() => removeUpload(u.path)}
                          >
                            <DeleteOutlined fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </RowActions>
                  }
                >
                  <ListItemText
                    primary={u.name}
                    secondary={`${u.size_mb} MB · ${mine ? "you" : u.uploader}`}
                    slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
}
