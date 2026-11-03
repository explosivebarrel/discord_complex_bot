import { Box, IconButton, List, ListItem, ListItemAvatar, ListItemText, Tooltip, Typography } from "@mui/material";
import { IconFavorite as Favorite, IconPlayArrow as PlayArrow, IconQueueMusic as QueueMusic } from "../icons";
import { PlaylistAddMenu } from "../PlaylistAddMenu";
import { CoverImg } from "./CoverImg";
import { RowActions, rowActionsRowSx } from "./RowActions";
import { SOURCE_LABELS } from "./labels";

export interface HistoryTabProps {
  played: import("../../api").TrackInfo[];
  favorites: { uri: string }[];
  toggleFavorite: (t: import("../../api").TrackInfo) => void;
  onReplay: (index: number, title: string) => void;
  onRequeue: (index: number, title: string) => void;
  onMenu: (e: React.MouseEvent, spec: import("../TrackMenu").TrackMenuSpec) => void;
}

/** The player History tab: this session's played tracks, newest first. */
export function HistoryTab({ played, favorites, toggleFavorite, onReplay, onRequeue, onMenu }: HistoryTabProps) {
  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 2 }, maxWidth: 900 }}>
      <Typography variant="h6" gutterBottom>
        Recently played
      </Typography>
      {played.length > 0 ? (
        <List disablePadding>
          {played.map((t, i) => (
            <ListItem
              key={`r${i}`}
              disableGutters
              dense
              onClick={() => onReplay(i, t.title)}
              onContextMenu={(e) =>
                onMenu(e, {
                  track: {
                    title: t.title,
                    author: t.author,
                    uri: t.uri ?? "",
                    source: t.source ?? "",
                    length_ms: t.length,
                    artwork: t.artwork,
                  },
                  favorite: favorites.some((f) => f.uri === t.uri),
                  onToggleFavorite: () => toggleFavorite(t),
                  onPlay: () => onReplay(i, t.title),
                  onQueue: () => onRequeue(i, t.title),
                })
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
                      aria-label="Add to queue"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequeue(i, t.title);
                      }}
                    >
                      <QueueMusic fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Play now">
                    <IconButton
                      size="small"
                      aria-label="Play now"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplay(i, t.title);
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
                      source: t.source ?? "",
                      length_ms: t.length,
                      artwork: t.artwork,
                    }}
                  />
                  <Tooltip title={favorites.some((f) => f.uri === t.uri) ? "Remove from favorites" : "Add to favorites"}>
                    <IconButton
                      size="small"
                      aria-label="Toggle favorite"
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
              <ListItemAvatar
                sx={{ minWidth: 36, width: 36, height: 36, display: "grid", placeItems: "center" }}
              >
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
  );
}
