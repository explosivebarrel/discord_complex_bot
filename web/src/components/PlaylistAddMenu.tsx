import { useEffect, useState } from "react";
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
import { IconPlaylistAdd as PlaylistAdd } from "./icons";
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

/** The playlist-picker body shared by the "add to playlist" icon menu and
    the track context menu's submenu: a new-playlist field plus the list of
    existing playlists. Calls onDone after a successful add. */
export function PlaylistMenuContent({
  track, onDone,
}: {
  track: PlaylistTrackRef;
  onDone?: () => void;
}) {
  const feedback = useFeedback();
  const [playlists, setPlaylists] = useState<UserPlaylistBrief[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .myPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, []);

  const add = async (fn: () => Promise<{ added: number; skipped: number } | unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const res = (await fn()) as { added?: number; skipped?: number } | undefined;
      feedback.show(
        res?.skipped ? `${okMsg} (${res.skipped} duplicate${res.skipped > 1 ? "s" : ""} skipped)` : okMsg,
      );
      onDone?.();
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
    </>
  );
}

/** Small "add to playlist" icon with a menu of the user's playlists. */
export function PlaylistAddMenu({ track, size = "small" }: { track: PlaylistTrackRef; size?: "small" | "medium" }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  return (
    <>
      <Tooltip title="Add to playlist">
        <IconButton size={size} onClick={(e) => setAnchor(e.currentTarget)} aria-label="Add to playlist">
          <PlaylistAdd fontSize={size === "small" ? "small" : "inherit"} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <PlaylistMenuContent track={track} onDone={close} />
      </Menu>
    </>
  );
}
