import { useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddQueue from "@mui/icons-material/Queue";
import Close from "@mui/icons-material/Close";
import PlayArrow from "@mui/icons-material/PlayArrow";
import SearchIcon from "@mui/icons-material/Search";
import Shuffle from "@mui/icons-material/Shuffle";
import LibraryMusic from "@mui/icons-material/LibraryMusic";
import { PlaylistPageInfo } from "../api";
import { PlaylistAddMenu } from "./PlaylistAddMenu";

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PlaylistBrowser({
  playlist,
  busy,
  onClose,
  onReload,
  onPlay,
  onAdd,
  onAddAll,
}: {
  playlist: PlaylistPageInfo;
  busy: boolean;
  onClose: () => void;
  onReload: (page: number, q: string) => void;
  onPlay: (index: number) => void;
  onAdd: (indices: number[]) => void;
  onAddAll: () => void;
}) {
  const [filter, setFilter] = useState("");

  const reload = (page: number, q: string) => onReload(page, q);
  const pageIndices = playlist.tracks.map((t) => t.index);
  const shuffledSample = () => {
    const indices = [...Array(playlist.matched || playlist.total).keys()];
    for (let i = indices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, 100);
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
          <LibraryMusic fontSize="small" sx={{ color: "text.secondary" }} />
          <Typography variant="h6" sx={{ flex: 1, minWidth: 0 }} noWrap>
            {playlist.title}
          </Typography>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} aria-label="Close playlist browser">
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
          {playlist.matched === playlist.total
            ? `${playlist.total} tracks`
            : `${playlist.matched} of ${playlist.total} tracks`}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Filter inside the playlist"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload(0, filter)}
            slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} /> } }}
          />
          <Button variant="tonal" onClick={() => reload(0, filter)}>
            Find
          </Button>
        </Stack>
        <List disablePadding dense sx={{ maxHeight: 420, overflow: "auto", mb: 1 }}>
          {playlist.tracks.map((t) => (
            <ListItem
              key={t.index}
              disableGutters
              dense
              secondaryAction={
                <Box sx={{ display: "flex", alignItems: "center" }}>
                  <Tooltip title="Play now">
                    <IconButton
                      size="small"
                      disabled={busy}
                      onClick={() => onPlay(t.index)}
                      sx={{ bgcolor: "#313038", "&:hover": { bgcolor: "#3D3847" } }}
                      aria-label="Play now"
                    >
                      <PlayArrow fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Add to queue">
                    <IconButton
                      size="small"
                      disabled={busy}
                      onClick={() => onAdd([t.index])}
                      sx={{ bgcolor: "#313038", "&:hover": { bgcolor: "#3D3847" }, ml: 0.25 }}
                      aria-label="Add to queue"
                    >
                      <AddQueue fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Box sx={{ ml: 0.25 }}>
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
                  </Box>
                </Box>
              }
            >
              <ListItemAvatar sx={{ minWidth: 34 }}>
                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
                  {t.index + 1}
                </Typography>
              </ListItemAvatar>
              <ListItemText
                primary={t.title}
                secondary={[t.author || "", fmt(t.length)].filter(Boolean).join(" · ")}
                slotProps={{
                  primary: { noWrap: true },
                  secondary: { noWrap: true },
                }}
              />
            </ListItem>
          ))}
          {playlist.tracks.length === 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>
              Nothing matches the filter.
            </Typography>
          )}
        </List>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="tonal"
            disabled={playlist.page <= 0 || busy}
            onClick={() => reload(playlist.page - 1, filter)}
          >
            Prev
          </Button>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {playlist.page + 1} / {playlist.pages}
          </Typography>
          <Button
            size="small"
            variant="tonal"
            disabled={playlist.page >= playlist.pages - 1 || busy}
            onClick={() => reload(playlist.page + 1, filter)}
          >
            Next
          </Button>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="tonal"
            disabled={busy || pageIndices.length === 0}
            onClick={() => onAdd(pageIndices)}
          >
            Add page
          </Button>
          <Button size="small" variant="tonal" disabled={busy} onClick={onAddAll}>
            Add all
          </Button>
          <Button
            size="small"
            variant="tonal"
            startIcon={<Shuffle />}
            disabled={busy}
            onClick={() => onAdd(shuffledSample())}
          >
            Shuffle +100
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
