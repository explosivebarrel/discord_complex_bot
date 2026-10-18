import { useEffect, useRef, useState } from "react";
import { Box, Chip, CircularProgress, IconButton, LinearProgress, Popover, Slider, Stack, Tooltip, Typography } from "@mui/material";
import { IconGraphicEq as GraphicEq, IconPause as Pause, IconPlayArrow as PlayArrow, IconRepeat as Repeat, IconRepeatOne as RepeatOne, IconSkipNext as SkipNext, IconSkipPrevious as SkipPrevious, IconStop as Stop, IconVolumeUp as VolumeUp } from "./icons";
import type { PlayerState } from "../api";
import { surfaceStyle } from "../themes/buildTheme";

const LIVE_LENGTH = 9223372036854775807;

function fmt(ms: number): string {
  if (ms >= LIVE_LENGTH) return "LIVE";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Thin draggable seek line along the top edge of the dock. */
function SeekLine({ position, length, onSeek }: { position: number; length: number; onSeek: (ms: number) => void }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragMs, setDragMs] = useState(0);
  const shown = dragging ? dragMs : Math.min(position, length);
  const pct = length > 0 ? Math.min((shown / length) * 100, 100) : 0;
  const msAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || length <= 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * length;
  };
  return (
    <Box
      ref={barRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setDragMs(msAt(e.clientX));
      }}
      onPointerMove={(e) => {
        if (dragging) setDragMs(msAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        setDragging(false);
        onSeek(Math.round(msAt(e.clientX)));
      }}
      sx={{
        position: "absolute",
        top: -9,
        left: 0,
        right: 0,
        height: 20,
        cursor: "pointer",
        touchAction: "none",
        display: "flex",
        alignItems: "center",
        "& .seek-thumb": { opacity: dragging ? 1 : 0 },
        "&:hover .seek-thumb": { opacity: 1 },
      }}
    >
      <Box
        sx={(t) => ({
          position: "relative",
          height: 4,
          width: "100%",
          borderRadius: 999,
          bgcolor: t.palette.m3.surfaceContainerHighest,
        })}
      >
        <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 999, bgcolor: "primary.main" }} />
        <Box
          className="seek-thumb"
          sx={{
            position: "absolute",
            top: "50%",
            left: `${pct}%`,
            width: 12,
            height: 12,
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            bgcolor: "primary.main",
            transition: "opacity .12s",
          }}
        />
      </Box>
    </Box>
  );
}

/**
 * Player dock pinned to the bottom of the content column (rendered by
 * AppShell's `dock` slot, so it never overlaps scrolling content). The play
 * button is a raised MD3 FAB; the track progress is a thin seek line along
 * the dock's top edge.
 */
export function PlayerDock({
  state,
  volume,
  onVolumeChange,
  onVolumeCommit,
  onPauseToggle,
  onPrevious,
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
  onPrevious: () => void;
  onSkip: () => void;
  onStop: () => void;
  onSeek: (positionMs: number) => void;
  onRepeatCycle: () => void;
}) {
  const current = state?.current;
  const paused = !!current?.paused;
  const isLive = !!current && current.length >= LIVE_LENGTH;
  const isLoading = !!current?.loading;
  const hasHistory = (state?.played?.length ?? 0) > 0;
  const repeat = state?.repeat ?? "off";
  const [livePos, setLivePos] = useState(0);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Advance the progress line locally between 3-second polls.
  useEffect(() => {
    if (!current || paused || isLive) return;
    setLivePos(current.position ?? 0);
    const timer = setInterval(() => setLivePos((p) => p + 1000), 1000);
    return () => clearInterval(timer);
  }, [current, paused, isLive]);

  if (!state || (!current && !state.connected)) return null;

  const position = isLive ? 0 : Math.min(livePos, current?.length ?? 0);

  return (
    <Box
      sx={(t) => ({
        position: "relative",
        ...surfaceStyle(t, t.palette.m3.surfaceContainerLow, "card"),
        px: { xs: 1.5, md: 3 },
        pt: { xs: 1.5, md: 2 },
        pb: 1.5,
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: { xs: "wrap", md: "nowrap" },
      })}
    >
      {current && (isLoading ? (
        <Box sx={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <LinearProgress sx={{ height: 4, borderRadius: 0 }} />
        </Box>
      ) : !isLive ? (
        <SeekLine position={position} length={Math.max(current.length, 1)} onSeek={onSeek} />
      ) : null)}

      {/* Left column takes the same flex width as the right one, so the
          transport cluster stays centered in the dock. On phones the
          description drops below the controls row. */}
      <Stack
        direction="row"
        spacing={2}
        sx={{ flex: 1, minWidth: 0, alignItems: "center", order: { xs: 1, md: 0 } }}
      >
      <Box sx={{ position: "relative", flexShrink: 0, width: 48, height: 48 }}>
        {current?.artwork ? (
          <Box
            component="img"
            src={current.artwork}
            sx={{ width: 48, height: 48, borderRadius: "12px", objectFit: "cover", opacity: isLoading ? 0.45 : 1 }}
          />
        ) : (
          <Box
            sx={(t) => ({
              width: 48,
              height: 48,
              borderRadius: "12px",
              bgcolor: t.palette.m3.surfaceContainerHighest,
              display: "grid",
              placeItems: "center",
            })}
          >
            <GraphicEq sx={{ color: "text.secondary" }} />
          </Box>
        )}
        {isLoading && <CircularProgress size={26} sx={{ position: "absolute", inset: "11px" }} />}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap>
          {current?.title ?? "Nothing playing"}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
          {current ? [current.author, current.requested_by].filter(Boolean).join(" · ") : "Join a voice channel and queue a track"}
        </Typography>
      </Box>

      {current && !isLoading && isLive && (
        <Chip size="small" label="LIVE" color="error" sx={{ flexShrink: 0, height: 20, fontSize: 11 }} />
      )}
      {current && !isLoading && !isLive && (
        <Typography
          variant="caption"
          sx={{ color: "text.secondary", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
        >
          {fmt(position)} / {fmt(current.length)}
        </Typography>
      )}
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "flex-start",
          flexShrink: 0,
          // Phones: the controls take the first row (FAB protrudes over the
          // dock's top edge, like on desktop) with the description below.
          flex: { xs: "1 1 100%", md: "0 0 auto" },
          justifyContent: { xs: "center", md: "flex-start" },
          order: { xs: 0, md: 0 },
        }}
      >
        <Tooltip title="Previous track">
          <span>
            <IconButton disabled={isLoading || !hasHistory} onClick={onPrevious} sx={{ mt: 0.5 }}>
              <SkipPrevious />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={paused ? "Resume" : "Pause"}>
          <span>
            <IconButton
              disabled={isLoading || !current}
              onClick={onPauseToggle}
              sx={(t) => ({
                width: 60,
                height: 60,
                borderRadius: "999px",
                mt: -4.5,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                boxShadow: t.palette.mode === "dark" ? "0 6px 16px rgba(0,0,0,.4)" : "0 6px 16px rgba(0,0,0,.18)",
                "&:hover": { bgcolor: "primary.main", filter: "brightness(1.08)" },
                // Keep the raised disc lavender while disabled (idle).
                "&.Mui-disabled": { bgcolor: "primary.main", color: "primary.contrastText", opacity: 0.45 },
              })}
            >
              {paused || !current ? <PlayArrow /> : <Pause />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Skip">
          <span>
            <IconButton disabled={isLoading || !current} onClick={onSkip} sx={{ mt: 0.5 }}>
              <SkipNext />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          alignItems: "center",
          flex: { xs: "0 0 auto", md: 1 },
          justifyContent: { xs: "flex-start", md: "flex-end" },
          order: { xs: 2, md: 0 },
        }}
      >
        <Tooltip title={`Repeat: ${repeat === "off" ? "off (click for queue)" : repeat === "all" ? "whole queue (click for one track)" : "one track (click to turn off)"}`}>
          <IconButton
            onClick={onRepeatCycle}
            sx={repeat !== "off" ? { color: "primary.main" } : { color: "text.secondary" }}
          >
            {repeat === "one" ? <RepeatOne /> : <Repeat />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Stop and clear the queue">
          <span>
            <IconButton onClick={onStop} disabled={!current && !state.queue.length} sx={{ color: "error.main" }}>
              <Stop />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ display: { xs: "none", md: "flex" }, alignItems: "center", gap: 0.5, width: 120, ml: 1 }}>
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
        {/* Below md the slider does not fit: the icon opens it in a popover. */}
        <Box sx={{ display: { xs: "flex", md: "none" } }}>
          <Tooltip title="Volume">
            <span>
              <IconButton
                aria-label="Volume"
                ref={volumeButtonRef}
                onClick={() => setVolumeOpen((open) => !open)}
              >
                <VolumeUp />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Stack>

      <Popover
        open={volumeOpen}
        anchorEl={volumeButtonRef.current}
        onClose={() => setVolumeOpen(false)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        sx={{ display: { md: "none" } }}
      >
        {/* Vertical drag reads like the phone's own volume control; the
            caption marks the current percent, the 100 point has no tick. */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, p: 1.5 }}>
          <Slider
            orientation="vertical"
            size="small"
            min={0}
            max={200}
            sx={{ height: 160 }}
            value={Math.min(volume, 200)}
            onChange={(_, v) => onVolumeChange(v as number)}
            onChangeCommitted={(_, v) => onVolumeCommit(v as number)}
          />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {Math.round(volume)}%
          </Typography>
        </Box>
      </Popover>
    </Box>
  );
}
