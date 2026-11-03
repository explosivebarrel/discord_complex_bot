import { Box, IconButton, List, ListItem, ListItemAvatar, ListItemText, Tooltip, Typography } from "@mui/material";
import { IconHistory as History, IconPlaylistAdd as PlaylistAdd, IconPlayArrow as PlayArrow } from "../icons";
import { SOURCE_LABELS } from "./labels";

export interface HistoryTabProps {
  played: import("../../api").TrackInfo[];
  hoveredRow: string | null;
  setHoveredRow: (v: string | null | ((h: string | null) => string | null)) => void;
  onReplay: (index: number, title: string) => void;
  onRequeue: (index: number, title: string) => void;
}

/** The player History tab: this session's played tracks, newest first. */
export function HistoryTab({ played, hoveredRow, setHoveredRow, onReplay, onRequeue }: HistoryTabProps) {
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
              sx={{
                cursor: "pointer",
                borderRadius: 1,
                "&:hover": { bgcolor: "action.hover" },
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
                        onRequeue(i, t.title);
                      }}
                      sx={(t) => ({
                        bgcolor: t.palette.m3.surfaceContainerHighest,
                        "&:hover": { bgcolor: t.palette.m3.secondaryContainer },
                        visibility: hoveredRow === `r${i}` ? "visible" : "hidden",
                        ["@media (hover: none)"]: { visibility: "visible" },
                      })}
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
                        onReplay(i, t.title);
                      }}
                      sx={(t) => ({
                        bgcolor: t.palette.m3.surfaceContainerHighest,
                        "&:hover": { bgcolor: t.palette.m3.secondaryContainer },
                        visibility: hoveredRow === `r${i}` ? "visible" : "hidden",
                        ["@media (hover: none)"]: { visibility: "visible" },
                      })}
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
  );
}
