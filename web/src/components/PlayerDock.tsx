import { useEffect, useRef, useState } from "react";
import { Box, Chip, CircularProgress, IconButton, LinearProgress, Popover, Slider, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { IconFavorite as Favorite, IconGraphicEq as GraphicEq, IconPause as Pause, IconPlayArrow as PlayArrow, IconRepeat as Repeat, IconRepeatOne as RepeatOne, IconSkipNext as SkipNext, IconSkipPrevious as SkipPrevious, IconStop as Stop, IconVolumeUp as VolumeUp } from "./icons";
import type { PlayerState } from "../api";
import { surfaceStyle } from "../themes/buildTheme";
import { useAppTheme } from "../themes/AppThemeContext";
import { useGlassIsland } from "./glass/glassRegistry";

const LIVE_LENGTH = 9223372036854775807;

function fmt(ms: number): string {
  if (ms >= LIVE_LENGTH) return "LIVE";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Thin draggable seek line along the top edge of the dock. Rendered in the
    DOM on every theme (the canvas cannot draw DOM content on top of the
    glass, so the line is never a scene island). */
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
        left: 28,
        right: 28,
        zIndex: 1,
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
  favorite,
  onToggleFavorite,
  playlistMenu,
  onOpenNowPlaying,
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
  favorite: boolean;
  onToggleFavorite?: () => void;
  playlistMenu?: React.ReactNode;
  /** Opens the full-screen now-playing view (click on artwork or title). */
  onOpenNowPlaying?: () => void;
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
  // The dock's measured width also drives the row-vs-stack layout decision.
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const attachDock = (el: HTMLDivElement | null) => {
    dockRef.current = el;
    if (el) setSize((p) => (p && p.w === el.offsetWidth && p.h === el.offsetHeight ? p : { w: el.offsetWidth, h: el.offsetHeight }));
  };
  const fabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Full WebGL glass: the dock and the FAB are scene islands — the lens is
  // painted beneath their transparent DOM; CSS glass stays the fallback.
  // `!!state` also re-runs the registration after the early-return mounts
  // the boxes (the ref callback fills them during that render's commit).
  // The FAB is a frosted panel by default (the small lens reads badly on a
  // 60px disc); the lens is a settings toggle.
  const { glassWebgl, glassTuning } = useAppTheme();
  const fabKind = glassTuning.fabFrost ? "panel" : "lens";
  const fabTint = glassTuning.fabFrost ? glassTuning.panelTint : glassTuning.lensTint;
  const fabTintAlpha = glassTuning.fabFrost ? glassTuning.panelTintAlpha : glassTuning.lensTintAlpha;
  useGlassIsland(
    dockRef,
    { radius: 20, kind: "lens" },
    glassWebgl && !!state,
  );
  useGlassIsland(
    fabRef,
    { radius: 30, kind: fabKind },
    glassWebgl && !!state,
  );
  // Layout mode from the dock's own width: below ~680px (sidebars open on
  // a small screen) one row cannot fit cover + title + transport + actions,
  // so the content stacks into three short rows. The inline volume slider
  // appears only when there is room for it next to the five icons.
  const singleRow = (size?.w ?? 0) >= 680;
  const showSliderBox = singleRow && (size?.w ?? 0) >= 980;

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
      ref={attachDock}
      sx={(t) => ({
        position: "relative",
        // Floating dock: narrower than the column, inset from the edges,
        // rounded — glass panels read as objects, not sheet edges. The
        // bottom margin clears the frame's overflow clip so the drop
        // shadow fades out instead of ending in a hard line.
        mx: { xs: 1.5, md: 3 },
        mb: { xs: 2, md: 3 },
        borderRadius: "20px",
        px: { xs: 1.5, md: 3 },
        pt: { xs: 1.5, md: 2 },
        pb: 1.5,
        // The scene paints the dock's shadow with the lens; the CSS
        // shadow only exists on the fallback path.
        boxShadow: glassWebgl ? "none" : "0 12px 32px rgba(0,0,0,.30)",
        ...(glassWebgl
          ? { bgcolor: "transparent" }
          : surfaceStyle(t, t.palette.m3.surfaceContainerLow, "card")),
      })}
    >
      {/* The scene paints the lens beneath this transparent window; the
          sheen sweep rides on top of either path. */}
      <Box sx={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden", pointerEvents: "none", zIndex: 1 }}>
        <Box
          sx={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: "34%",
            background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.09), transparent)",
            transform: "translateX(-150%) skewX(-18deg)",
            animation: "dock-sheen 11s ease-in-out infinite",
            "@keyframes dock-sheen": {
              "0%, 55%": { transform: "translateX(-150%) skewX(-18deg)" },
              "85%, 100%": { transform: "translateX(400%) skewX(-18deg)" },
            },
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        />
      </Box>
      {current && (isLoading ? (
        // Same inset and geometry as the seek line it replaces, so the
        // switch from loading to playback does not jump.
        <Box sx={{ position: "absolute", top: -1, left: 28, right: 28, zIndex: 1 }}>
          <LinearProgress sx={{ height: 4, borderRadius: 999 }} />
        </Box>
      ) : !isLive ? (
        <SeekLine position={position} length={Math.max(current.length, 1)} onSeek={onSeek} />      ) : null)}

      {/* Dock content rides above the warp layer, so text and controls
          never take the lens distortion. The row-vs-stack decision keys off
          the dock's own measured width (not the viewport): sidebar states
          change how much room is left, and the resize observer already
          tracks this box for the glass lens. */}
      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: 2,
          flexWrap: singleRow ? "nowrap" : "wrap",
        }}
      >
      {/* Left column takes the same flex width as the right one, so the
          transport cluster stays centered in the dock. When the dock is too
          narrow for one row (sidebars open on a small screen), the
          description gets its own full row and the action cluster wraps
          below it — three short rows instead of one squeezed. */}
      <Stack
        direction="row"
        spacing={2}
        sx={{ flex: singleRow ? "1 1 0%" : "1 1 100%", minWidth: 0, alignItems: "center", order: singleRow ? 0 : 1 }}
      >
      <Box
        onClick={onOpenNowPlaying}
        sx={{
          position: "relative", flexShrink: 0, width: 48, height: 48,
          cursor: onOpenNowPlaying ? "pointer" : undefined,
        }}
      >
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

      <Box
        onClick={onOpenNowPlaying}
        sx={{ flex: 1, minWidth: 0, cursor: onOpenNowPlaying ? "pointer" : undefined }}
      >
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
          // Narrow widths: the controls take the first row (FAB protrudes
          // over the dock's top edge, like on desktop) with the description
          // and actions on the rows below.
          flex: singleRow ? "0 0 auto" : "1 1 100%",
          justifyContent: singleRow ? "flex-start" : "center",
          order: 0,
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
              ref={fabRef}
              disabled={isLoading || !current}
              onClick={onPauseToggle}
              sx={(t) => ({
                width: 60,
                height: 60,
                borderRadius: "999px",
                mt: -4.5,
                position: "relative",
                ...(t.surface.islands
                    ? glassWebgl
                    ? {
                        // The scene paints the round glass (frost or lens,
                        // per the settings toggle) beneath the transparent
                        // button; the tint matches the canvas shading.
                        bgcolor: alpha(fabTint, fabTintAlpha),
                        zIndex: 2,
                        color: t.palette.m3.onSurface,
                        "&:hover": { bgcolor: alpha(fabTint, Math.min(fabTintAlpha + 0.15, 1)) },
                        "&.Mui-disabled": { bgcolor: alpha(fabTint, fabTintAlpha * 0.7), color: t.palette.m3.onSurface, opacity: 0.5 },
                      }
                    : {
                        // Liquid-glass FAB: translucent tint; the glyph
                        // stays sharp above the frosted disc.
                        bgcolor: alpha(t.palette.primary.main, 0.42),
                        color: t.palette.primary.contrastText,
                        boxShadow: `inset 0 1px 0 ${alpha("#FFFFFF", 0.3)}, 0 6px 20px rgba(0,0,0,.45)`,
                        "&:hover": { bgcolor: alpha(t.palette.primary.main, 0.55) },
                        "&.Mui-disabled": { bgcolor: alpha(t.palette.primary.main, 0.42), color: t.palette.primary.contrastText, opacity: 0.45 },
                      }
                  : {
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      boxShadow: t.palette.mode === "dark" ? "0 6px 16px rgba(0,0,0,.4)" : "0 6px 16px rgba(0,0,0,.18)",
                      "&:hover": { bgcolor: "primary.main", filter: "brightness(1.08)" },
                      // Keep the raised disc lavender while disabled (idle).
                      "&.Mui-disabled": { bgcolor: "primary.main", color: "primary.contrastText", opacity: 0.45 },
                    }),
              })}
            >
              <Box component="span" sx={{ position: "relative", zIndex: 1, display: "flex" }}>
                {paused || !current ? <PlayArrow /> : <Pause />}
              </Box>
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
          flex: singleRow ? "1 1 0%" : "1 1 100%",
          justifyContent: singleRow ? "flex-end" : "center",
          order: singleRow ? 0 : 2,
        }}
      >
        {/* Current-track actions live with the transport side of the dock:
            like (filled when already favorited) and add-to-playlist. */}
        {current && (
          <>
            <Tooltip title={favorite ? "Remove from favorites" : "Add to favorites"}>
              <IconButton onClick={onToggleFavorite} aria-label="Toggle favorite" sx={favorite ? { color: "primary.main" } : undefined}>
                <Favorite filled={favorite} />
              </IconButton>
            </Tooltip>
            {playlistMenu}
          </>
        )}
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
        {/* The inline slider needs ~120px on top of the five icons: with a
            wide dock it fits, otherwise the icon + popover takes over (the
            popover caption shows the exact percent). */}
        {showSliderBox && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, width: 120, ml: 1 }}>
            <VolumeUp fontSize="small" sx={{ color: "text.secondary" }} />
            <Slider
              size="small"
              min={0}
              max={200}
              value={Math.min(volume, 200)}
              onChange={(_, v) => onVolumeChange(v as number)}
              onChangeCommitted={(_, v) => onVolumeCommit(v as number)}
              // The scale is 0-200 with 100% in the middle: a hover bubble and
              // a center tick keep the actual value readable.
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v}%`}
              marks={[{ value: 100 }]}
            />
          </Box>
        )}
        {/* Narrow dock: the icon opens the volume popover instead. */}
        {!showSliderBox && (
          <Box sx={{ display: "flex" }}>
            <Tooltip title={`Volume: ${Math.round(volume)}%`}>
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
        )}
      </Stack>
      </Box>

      <Popover
        open={volumeOpen}
        anchorEl={volumeButtonRef.current}
        onClose={() => setVolumeOpen(false)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
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
