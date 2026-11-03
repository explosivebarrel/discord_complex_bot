import { useState } from "react";
import {
  Box, Button, Card, CardContent, CircularProgress, IconButton, List, ListItem, ListItemAvatar, ListItemText,
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
import type { TrackMenuSpec } from "../TrackMenu";
import { PlaylistBrowser } from "../PlaylistBrowser";
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
  myPls: { id: number; name: string; tracks: number; artwork?: string | null }[];
  likedOpen: boolean;
  onOpenLiked: () => void;
  onBack: () => void;
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
  onReloadBrowser: (page: number, q: string) => void;
  onBrowserPlay: (index: number) => void;
  onBrowserAdd: (indices: number[]) => void;
  onBrowserAddAll: () => void;
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

/** The player Collection tab, Yandex-Music style: a liked-tracks block
    (hero + two-column preview), playlist cards with an inline "new
    playlist" tile, uploads, and a full playlist page with a hero. The
    liked page and playlist pages are URL routes: Back returns to the
    previous view. */
export function CollectionTab(props: CollectionTabProps) {
  const {
    me, favorites, onPlayFavorite, onQueueFavorite, onRemoveFavorite, onMenu, myPls, likedOpen, onOpenLiked, onBack,
    openPl, plOpening, createPlaylist, plBusy, onShufflePlay, onPlayPlaylist, onOpenPlaylist, onDetailDelete,
    onQueueAll, onPlayPlaylistTrack, onQueuePlaylistTrack, onRemovePlaylistTrack, onQueueFavorites,
    uploads, canModerateUploads, queueUpload, removeUpload, enqueueing, playlist, playlistBusy, onCloseBrowser,
    onReloadBrowser, onBrowserPlay, onBrowserAdd, onBrowserAddAll,
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
      onPlay={() => onPlayFavorite({
        uri: f.uri, source: f.source || "yt", title: f.title,
        author: f.author, length_ms: f.length_ms, artwork: f.artwork,
      })}
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
              <Button size="small" variant="text" onClick={onBack} sx={{ alignSelf: "center" }}>
                Back
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

  // ---- Full playlist page (its own route) ----
  if (openPl) {
    const cover = openPl.tracks.find((t) => t.artwork)?.artwork ?? null;
    const visible = openPl.tracks.filter((t) =>
      !plFilter.trim() || t.title.toLowerCase().includes(plFilter.trim().toLowerCase()));
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 1000 }}>
        {playlist && (
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <PlaylistBrowser
                playlist={playlist}
                busy={playlistBusy}
                onClose={onCloseBrowser}
                onReload={onReloadBrowser}
                onPlay={onBrowserPlay}
                onAdd={onBrowserAdd}
                onAddAll={onBrowserAddAll}
              />
            </CardContent>
          </Card>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2, alignItems: { sm: "center" } }}>
          <CoverImg src={cover} size={120} radius="12px" />
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
              <Button size="small" variant="text" onClick={onBack} sx={{ alignSelf: "center" }}>
                Back
              </Button>
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
                onPlay={() => onPlayPlaylistTrack(index, t.title)}
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
      {playlist && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <PlaylistBrowser
              playlist={playlist}
              busy={playlistBusy}
              onClose={onCloseBrowser}
              onReload={onReloadBrowser}
              onPlay={onBrowserPlay}
              onAdd={onBrowserAdd}
              onAddAll={onBrowserAddAll}
            />
          </CardContent>
        </Card>
      )}

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
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 3 }}>
            <List disablePadding>{leftCol.map(favRow)}</List>
            <List disablePadding>{rightCol.map(favRow)}</List>
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
                <CoverImg src={p.artwork} size={148} radius="12px" />
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
                  sx={{ ...rowActionsRowSx }}
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
