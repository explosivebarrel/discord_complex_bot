import { useState } from "react";
import {
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
    playlist (submenu) plus the caller's context-specific items. */
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
  const [subAnchor, setSubAnchor] = useState<HTMLElement | null>(null);

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
      <MenuItem onClick={(e) => setSubAnchor(e.currentTarget)}>
        <ListItemIcon><MsIcon name="playlist_add" fontSize={20} /></ListItemIcon>
        <ListItemText>Add to playlist</ListItemText>
        <MsIcon name="chevron_right" fontSize={20} sx={{ color: "text.secondary" }} />
      </MenuItem>
      <Menu
        open={!!subAnchor}
        anchorEl={subAnchor}
        onClose={() => setSubAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { maxHeight: 380 } } }}
      >
        <PlaylistMenuContent track={track} onDone={() => { setSubAnchor(null); onClose(); }} />
      </Menu>
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
