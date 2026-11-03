import { useState } from "react";
import {
  Box,
  Collapse,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  IconFavorite as Favorite,
  IconPlayArrow as PlayArrow,
  IconQueueMusic as QueueMusic,
} from "./icons";
import { MsIcon } from "./MsIcon";
import { PlaylistMenuContent, type PlaylistTrackRef } from "./PlaylistAddMenu";

/** Everything the context menu needs to act on one track. Extra items are
    context-specific entries (remove from queue, delete upload, …) rendered
    in a trailing group. */
export interface TrackMenuSpec {
  track: PlaylistTrackRef;
  onPlay?: () => void;
  onQueue?: () => void;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  extra?: {
    key: string;
    label: string;
    icon?: string;
    onClick: () => void;
    danger?: boolean;
  }[];
}

type OpenFn = (e: React.MouseEvent, spec: TrackMenuSpec) => void;

/** Right-click menu for a track row/card: play, queue, favorite, add to
    playlist plus the caller's context-specific items. The playlist picker
    expands inline (a nested Menu modal swallows clicks, so no submenu). */
export function useTrackMenu(): { open: OpenFn; node: React.ReactNode } {
  const [spec, setSpec] = useState<(TrackMenuSpec & { pos: { x: number; y: number } }) | null>(null);
  const open: OpenFn = (e, s) => {
    e.preventDefault();
    e.stopPropagation();
    setSpec({ ...s, pos: { x: e.clientX, y: e.clientY } });
  };
  const node = spec ? <TrackMenu spec={spec} onClose={() => setSpec(null)} /> : null;
  return { open, node };
}

function TrackMenu({ spec, onClose }: { spec: TrackMenuSpec & { pos: { x: number; y: number } }; onClose: () => void }) {
  const { track, onPlay, onQueue, favorite, onToggleFavorite, extra, pos } = spec;
  const [plOpen, setPlOpen] = useState(false);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Menu
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: pos.y, left: pos.x }}
      slotProps={{ paper: { sx: { minWidth: 240, maxHeight: 480 } } }}
      sx={{ zIndex: (t) => t.zIndex.modal + 1 }}
    >
      {onPlay && (
        <MenuItem onClick={run(onPlay)}>
          <ListItemIcon><PlayArrow fontSize="small" /></ListItemIcon>
          <ListItemText>Play now</ListItemText>
        </MenuItem>
      )}
      {onQueue && (
        <MenuItem onClick={run(onQueue)}>
          <ListItemIcon><QueueMusic fontSize="small" /></ListItemIcon>
          <ListItemText>Add to queue</ListItemText>
        </MenuItem>
      )}
      {onToggleFavorite && (
        <MenuItem onClick={run(onToggleFavorite)}>
          <ListItemIcon><Favorite filled={favorite} fontSize="small" /></ListItemIcon>
          <ListItemText>{favorite ? "Remove from favorites" : "Add to favorites"}</ListItemText>
        </MenuItem>
      )}
      <Divider sx={{ my: 0.5 }} />
      <MenuItem onClick={() => setPlOpen((v) => !v)}>
        <ListItemIcon><MsIcon name="playlist_add" fontSize={20} /></ListItemIcon>
        <ListItemText>Add to playlist</ListItemText>
        <MsIcon
          name="keyboard_arrow_down"
          fontSize={20}
          sx={{
            color: "text.secondary",
            transform: plOpen ? "rotate(180deg)" : "none",
            transition: (t) => t.transitions.create("transform", { duration: t.transitions.duration.short }),
          }}
        />
      </MenuItem>
      <Collapse in={plOpen} timeout="auto" unmountOnExit>
        <Box sx={{ py: 0.5, maxHeight: 300, overflowY: "auto" }}>
          <PlaylistMenuContent track={track} onDone={onClose} />
        </Box>
      </Collapse>
      {(extra?.length ?? 0) > 0 && <Divider sx={{ my: 0.5 }} />}
      {extra?.map((item) => (
        <MenuItem key={item.key} onClick={run(item.onClick)} sx={item.danger ? { color: "error.main" } : undefined}>
          {item.icon && (
            <ListItemIcon>
              <MsIcon name={item.icon} fontSize={20} sx={item.danger ? { color: "error.main" } : undefined} />
            </ListItemIcon>
          )}
          <ListItemText>{item.label}</ListItemText>
        </MenuItem>
      ))}
    </Menu>
  );
}
