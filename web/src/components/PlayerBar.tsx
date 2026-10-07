import { useEffect, useState } from "react";
import { Box, Chip, IconButton, Slider, Tooltip, Typography } from "@mui/material";
import Pause from "@mui/icons-material/Pause";
import PlayArrow from "@mui/icons-material/PlayArrow";
import SkipNext from "@mui/icons-material/SkipNext";
import Stop from "@mui/icons-material/Stop";
import Repeat from "@mui/icons-material/Repeat";
import RepeatOne from "@mui/icons-material/RepeatOne";
import VolumeUp from "@mui/icons-material/VolumeUp";
import GraphicEq from "@mui/icons-material/GraphicEq";
import type { PlayerState } from "../api";

const LIVE_LENGTH = 9223372036854775807;

function fmt(ms: number): string {
  if (ms >= LIVE_LENGTH) return "LIVE";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PlayerBar({
  state,
  volume,
  onVolumeChange,
  onVolumeCommit,
  onPauseToggle,
  onSkip,
  onStop,
  onSeek,
  onRepeatCycle,
}: {
  state: PlayerState | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  onVolumeCommit: (v: number) => void;
  onPauseToggle: () => void;
  onSkip: () => void;
  onStop: () => void;
  onSeek: (positionMs: number) => void;
  onRepeatCycle: () => void;
}) {
  const current = state?.current;
  const paused = !!current?.paused;
  const isLive = !!current && current.length >= LIVE_LENGTH;
  const repeat = state?.repeat ?? "off";
  const [livePos, setLivePos] = useState(0);

  // Advance the progress bar locally between 3-second polls.
  useEffect(() => {
    if (!current || paused || isLive) return;
    setLivePos(current.position ?? 0);
    const timer = setInterval(() => setLivePos((p) => p + 1000), 1000);
    return () => clearInterval(timer);
  }, [current, paused, isLive]);

  if (!state || !current) return null;

  const position = isLive ? 0 : Math.min(livePos, current.length);

  return (
    <Box
      sx={{
        position: "fixed",
        left: { xs: 8, sm: 16 },
        right: { xs: 8, sm: 16 },
        bottom: { xs: 8, sm: 16 },
        bgcolor: "#2B2930",
        borderRadius: "20px",
        px: 2,
        py: 1.25,
        display: "flex",
        alignItems: "center",
        gap: 2,
        boxShadow: "0 8px 24px rgba(0,0,0,.45)",
        flexWrap: { xs: "wrap", md: "nowrap" },
      }}
    >
      {current.artwork ? (
        <Box
          component="img"
          src={current.artwork}
          sx={{ width: 52, height: 52, borderRadius: "12px", objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <Box
          sx={{
            width: 52,
            height: 52,
            borderRadius: "12px",
            bgcolor: "#49454F",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <GraphicEq />
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap>
          {current.title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
          {current.author ?? ""}
          {current.requested_by ? ` · ${current.requested_by}` : ""}
        </Typography>
        {isLive ? (
          <Chip size="small" label="LIVE" color="error" sx={{ mt: 0.5, height: 20, fontSize: 11 }} />
        ) : (
          <>
            <Slider
              size="small"
              min={0}
              max={Math.max(current.length, 1)}
              value={position}
              onChange={(_, v) => onSeek(v as number)}
              sx={{ mt: 0.5, mx: 0 }}
            />
            <Box sx={{ display: "flex", justifyContent: "space-between", mt: -1 }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {fmt(position)}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {fmt(current.length)}
              </Typography>
            </Box>
          </>
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
        <Tooltip title={paused ? "Resume" : "Pause"}>
          <IconButton onClick={onPauseToggle} sx={{ bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.main" } }}>
            {paused ? <PlayArrow /> : <Pause />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Skip">
          <IconButton onClick={onSkip}>
            <SkipNext />
          </IconButton>
        </Tooltip>
        <Tooltip title={`Repeat: ${repeat === "off" ? "off (click for queue)" : repeat === "all" ? "whole queue (click for one track)" : "one track (click to turn off)"}`}>
          <IconButton
            onClick={onRepeatCycle}
            sx={repeat !== "off" ? { color: "primary.main" } : { color: "text.secondary" }}
          >
            {repeat === "one" ? <RepeatOne /> : <Repeat />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Stop and clear the queue">
          <IconButton onClick={onStop} sx={{ color: "error.main" }}>
            <Stop />
          </IconButton>
        </Tooltip>
        <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: 0.5, width: 150, ml: 1 }}>
          <VolumeUp fontSize="small" sx={{ color: "text.secondary" }} />
          <Slider
            size="small"
            min={0}
            max={200}
            value={Math.min(volume, 200)}
            onChange={(_, v) => onVolumeChange(v as number)}
            onChangeCommitted={(_, v) => onVolumeCommit(v as number)}
          />
        </Box>
      </Box>
    </Box>
  );
}
