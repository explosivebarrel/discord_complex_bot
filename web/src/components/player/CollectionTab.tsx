import {
  Box, Button, Card, CardContent, IconButton, List, ListItem, ListItemAvatar, ListItemText, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  IconDelete as DeleteOutlined,
  IconShuffle as Shuffle,
  IconFavorite as Favorite,
  IconMusicNote as MusicNote,
  IconPlayArrow as PlayArrow,
} from "../icons";
import { PlaylistAddMenu } from "../PlaylistAddMenu";
import { PlaylistBrowser } from "../PlaylistBrowser";
import { fmt, SOURCE_LABELS } from "./labels";

export interface CollectionTabProps {
  gid: string;
  me: { discord_id: string } | null;
  favorites: {
    id: number; title: string; author: string; uri: string;
    source: string; length_ms: number; artwork: string | null;
  }[];
  onPlayFavorite: (f: { uri: string; source: string; title: string; author: string; length_ms: number; artwork: string | null }) => void;
  onRemoveFavorite: (id: number) => void;
  myPls: { id: number; name: string; tracks: number }[];
  openPl: { id: number; name: string; tracks: { id: number; title: string; author: string; source: string; length_ms: number }[] } | null;
  onClosePlaylist: () => void;
  newPlName: string;
  setNewPlName: (v: string) => void;
  createPlaylist: () => void;
  plBusy: boolean;
  openPlaylistTracks: (pid: number) => void;
  onShufflePlay: (pid: number, name: string) => void;
  onDeletePlaylist: (pid: number, name: string) => void;
  onQueueAll: () => void;
  onPlayPlaylistTrack: (index: number, title: string) => void;
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

/** The player Collection tab: saved playlists, favorites and uploads. */
export function CollectionTab(props: CollectionTabProps) {
  const {
    me, favorites, onPlayFavorite, onRemoveFavorite, myPls, openPl, onClosePlaylist, newPlName, setNewPlName,
    createPlaylist, plBusy, openPlaylistTracks, onShufflePlay, onDeletePlaylist, onQueueAll,
    onPlayPlaylistTrack, onRemovePlaylistTrack, uploads, canModerateUploads, queueUpload, removeUpload,
    enqueueing, playlist, playlistBusy, onCloseBrowser, onReloadBrowser, onBrowserPlay, onBrowserAdd, onBrowserAddAll,
  } = props;
  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 900 }}>
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

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>My playlists</Typography>
          {openPl ? (
            <>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                <Button size="small" variant="text" onClick={onClosePlaylist}>Back</Button>
                <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }} noWrap>{openPl.name}</Typography>
                <Button size="small" variant="tonal" disabled={plBusy || openPl.tracks.length === 0} onClick={onQueueAll}>
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
                          <IconButton size="small" disabled={plBusy} onClick={() => onPlayPlaylistTrack(i, t.title)}>
                            <PlayArrow fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove from playlist">
                          <IconButton size="small" disabled={plBusy} onClick={() => onRemovePlaylistTrack(t.id)}>
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
                      slotProps={{ primary: { noWrap: true, sx: { pr: 2 } }, secondary: { noWrap: true, sx: { pr: 2 } } }}
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
                          <Tooltip title="Shuffle play">
                            <IconButton size="small" disabled={plBusy} onClick={() => onShufflePlay(p.id, p.name)}>
                              <Shuffle fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Open playlist">
                            <IconButton size="small" disabled={plBusy} onClick={() => openPlaylistTracks(p.id)}>
                              <PlayArrow fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete playlist">
                            <IconButton size="small" disabled={plBusy} onClick={() => onDeletePlaylist(p.id, p.name)}>
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
                          slotProps={{ primary: { noWrap: true, sx: { pr: 2 } }, secondary: { noWrap: true, sx: { pr: 2 } } }}
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

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Favorites ({favorites.length})</Typography>
          {favorites.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Nothing here yet. Tap the heart on any search result.
            </Typography>
          ) : (
            <List disablePadding>
              {favorites.map((f) => (
                <ListItem
                  key={f.id}
                  disableGutters
                  dense
                  secondaryAction={
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title="Play now">
                        <IconButton
                          size="small"
                          onClick={() => onPlayFavorite({
                            uri: f.uri, source: f.source || "yt", title: f.title,
                            author: f.author, length_ms: f.length_ms, artwork: f.artwork,
                          })}
                        >
                          <PlayArrow fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <PlaylistAddMenu
                        track={{
                          title: f.title, author: f.author, uri: f.uri,
                          source: f.source, length_ms: f.length_ms, artwork: f.artwork,
                        }}
                      />
                      <Tooltip title="Remove from favorites">
                        <IconButton size="small" onClick={() => onRemoveFavorite(f.id)}>
                          <Favorite filled fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                >
                  <ListItemAvatar sx={{ minWidth: 40 }}>
                    {f.artwork ? (
                      <Box component="img" src={f.artwork} sx={{ width: 40, height: 40, borderRadius: "8px", objectFit: "cover" }} />
                    ) : (
                      <Box sx={(t) => ({ width: 40, height: 40, borderRadius: "8px", bgcolor: t.palette.m3.surfaceContainerHigh, display: "grid", placeItems: "center" })}>
                        <MusicNote sx={{ color: "text.secondary" }} />
                      </Box>
                    )}
                  </ListItemAvatar>
                  <ListItemText
                    primary={f.title}
                    secondary={[SOURCE_LABELS[f.source] ?? "", f.author, f.length_ms ? fmt(f.length_ms) : ""].filter(Boolean).join(" · ")}
                    slotProps={{ primary: { noWrap: true, sx: { pr: 2 } }, secondary: { noWrap: true, sx: { pr: 2 } } }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>My uploads</Typography>
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
                    secondaryAction={
                      <Stack direction="row" spacing={0.25}>
                        <Tooltip title="Queue">
                          <IconButton
                            edge="end"
                            aria-label={`Queue ${u.name}`}
                            disabled={enqueueing !== null}
                            onClick={() => queueUpload(`up:${u.path}`, u.path, u.name)}
                          >
                            <MsIconPlus busy={enqueueing === `up:${u.path}`} />
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
                      </Stack>
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
        </CardContent>
      </Card>
    </Box>
  );
}

function MsIconPlus({ busy }: { busy: boolean }) {
  if (busy) return <Typography variant="body2">…</Typography>;
  return (
    <Typography variant="body2" sx={{ lineHeight: 1 }}>
      +
    </Typography>
  );
}
