import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  ListItemButton,
  ListItemText,
  Menu,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import PlaylistAdd from "@mui/icons-material/PlaylistAdd";
import { api, UserPlaylistBrief } from "../api";
import { useFeedback } from "./Feedback";

export interface PlaylistTrackRef {
  title: string;
  author?: string | null;
  uri: string;
  source?: string | null;
  length_ms?: number;
  artwork?: string | null;
}

/** Small "add to playlist" icon with a menu of the user's playlists. */
export function PlaylistAddMenu({ track }: { track: PlaylistTrackRef }) {
  const feedback = useFeedback();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [playlists, setPlaylists] = useState<UserPlaylistBrief[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (e: React.MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
    api
      .myPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  };
  const close = () => setAnchor(null);

  const add = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      feedback.show(okMsg);
      close();
    } catch (err) {
      feedback.show((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const addTo = (playlist: UserPlaylistBrief) =>
    add(
      () =>
        api.addUserPlaylistTracks(playlist.id, [
          {
            title: track.title,
            author: track.author ?? "",
            uri: track.uri,
            source: track.source ?? "",
            length_ms: track.length_ms ?? 0,
            artwork: track.artwork ?? null,
          },
        ]),
      `Added to "${playlist.name}"`,
    );

  const createAndAdd = () => {
    const name = newName.trim();
    if (!name || busy) return;
    add(async () => {
      const created = await api.createUserPlaylist(name);
      await api.addUserPlaylistTracks(created.id, [
        {
          title: track.title,
          author: track.author ?? "",
          uri: track.uri,
          source: track.source ?? "",
          length_ms: track.length_ms ?? 0,
          artwork: track.artwork ?? null,
        },
      ]);
    }, `Added to new playlist "${name}"`);
    setNewName("");
  };

  return (
    <>
      <Tooltip title="Add to playlist">
        <IconButton
          size="small"
          onClick={open}
          sx={{ bgcolor: "#313038", "&:hover": { bgcolor: "#3D3847" } }}
          aria-label="Add to playlist"
        >
          <PlaylistAdd fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <Box sx={{ px: 2, py: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="New playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
          />
          <Button size="small" variant="tonal" disabled={!newName.trim() || busy} onClick={createAndAdd} sx={{ mt: 0.5 }}>
            Create and add
          </Button>
        </Box>
        {playlists.length > 0 && (
          <Typography variant="caption" sx={{ color: "text.secondary", px: 2, pt: 1, display: "block" }}>
            Add to existing
          </Typography>
        )}
        {playlists.map((p) => (
          <ListItemButton key={p.id} disabled={busy} onClick={() => addTo(p)}>
            <ListItemText
              primary={p.name}
              secondary={`${p.tracks} track(s)`}
              slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
            />
          </ListItemButton>
        ))}
      </Menu>
    </>
  );
}
