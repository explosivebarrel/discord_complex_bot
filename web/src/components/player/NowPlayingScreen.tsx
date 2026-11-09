import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import {
  IconFavorite as Favorite,
  IconGraphicEq as GraphicEq,
  IconKeyboardArrowDown as KeyboardArrowDown,
  IconLyrics as LyricsIcon,
  IconPause as Pause,
  IconPlayArrow as PlayArrow,
  IconRepeat as Repeat,
  IconRepeatOne as RepeatOne,
  IconShuffle as Shuffle,
  IconSkipNext as SkipNext,
  IconSkipPrevious as SkipPrevious,
} from "../icons";
import { MsIcon } from "../MsIcon";
import type { PlayerState } from "../../api";

const LIVE_LENGTH = 9223372036854775807;

function fmt(ms: number): string {
  if (ms >= LIVE_LENGTH) return "LIVE";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Full-screen "now playing" view, Yandex-Music style: a huge cover over a
    blurred backdrop of the artwork, title/author and a seek line beneath.
    Hovering (or touching) the cover reveals the transport; the chevron
    collapses back to the player. */
export function NowPlayingScreen({
  state,
  gid,
  favorite,
  onToggleFavorite,
  onPauseToggle,
  onPrevious,
  onSkip,
  onSeek,
  onRepeatCycle,
  onShuffleQueue,
  onMenu,
  onClose,
  /** Push from the dock's "Lyrics" row: open the screen with the lyrics
      column visible. */
  openLyrics = false,
}: {
  state: PlayerState;
  gid: string;
  favorite: boolean;
  onToggleFavorite: () => void;
  onPauseToggle: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  onSeek: (ms: number) => void;
  onRepeatCycle: () => void;
  onShuffleQueue: () => void;
  /** Opens the shared track context menu (the "…" button). */
  onMenu: (e: React.MouseEvent) => void;
  onClose: () => void;
  openLyrics?: boolean;
}) {
  const current = state.current;
  const paused = !!current?.paused;
  const isLive = !!current && current.length >= LIVE_LENGTH;
  const isLoading = !!current?.loading;
  const repeat = state.repeat ?? "off";
  // Advance the progress line locally between 3-second polls (same as the dock).
  const [livePos, setLivePos] = useState(0);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const dragRef = useRef(false);
  const position = Math.min(livePos, current?.length ?? 0);
  // Lyrics: fetched once per track uri; synced lines follow the position.
  const lyricsQuery = useQuery({
    queryKey: ["lyrics", current?.uri ?? ""],
    queryFn: () => api.lyrics(gid),
    enabled: !!current?.uri,
    staleTime: Infinity,
  });
  const synced: [number, string][] = lyricsQuery.data?.synced ?? [];
  const hasLyrics = synced.length > 0 || !!lyricsQuery.data?.plain;
  // Yandex-style lyrics column: hidden by default, opened with the Lyrics
  // button (or pushed from the dock row).
  const [lyricsOpen, setLyricsOpen] = useState(false);
  useEffect(() => {
    if (openLyrics) setLyricsOpen(true);
  }, [openLyrics]);
  // No lyrics at all: the toggle has nothing to show, close the column.
  useEffect(() => {
    if (lyricsQuery.isSuccess && !hasLyrics) setLyricsOpen(false);
  }, [lyricsQuery.isSuccess, hasLyrics]);
  const posSec = position / 1000;
  const activeLine = (() => {
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i][0] <= posSec) idx = i;
      else break;
    }
    return idx;
  })();
  // Countdown to the first line while the intro is still playing.
  const countdown =
    synced.length > 0 && activeLine === -1 ? Math.max(1, Math.ceil(synced[0][0] - posSec)) : null;
  const lyricsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lyricsOpen) return;
    const box = lyricsRef.current;
    if (!box) return;
    const active = box.querySelector<HTMLElement>("[data-active='true']");
    if (active) active.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLine, lyricsOpen]);

  useEffect(() => {
    if (!current || paused || isLive) return;
    setLivePos(current.position ?? 0);
    const timer = setInterval(() => setLivePos((p) => p + 1000), 1000);
    return () => clearInterval(timer);
  }, [current, paused, isLive]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!current) return null;
  const length = Math.max(current.length, 1);
  const pct = Math.min(((dragMs ?? position) / length) * 100, 100);

  const iconBtn = (label: string, onClick: (e: React.MouseEvent) => void, node: React.ReactNode, disabled?: boolean, extraSx?: object) => (
    <Tooltip title={label}>
      <span>
        <IconButton onClick={onClick} disabled={disabled} aria-label={label} sx={{ color: "#fff", ...extraSx }}>
          {node}
        </IconButton>
      </span>
    </Tooltip>
  );

  // Portal to <body>: ancestors carry backdrop-filter, which would turn
  // position:fixed into a containing block and keep the overlay trapped
  // inside the content column.
  return createPortal(
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: (t) => t.zIndex.appBar + 5,
        overflow: "hidden",
        display: "grid",
        // The column track must be the container, not the content's
        // max-content: with placeItems center an auto track grew to the
        // wrapper's fit-content width and pushed the layout off-screen
        // on phones.
        gridTemplateColumns: "minmax(0, 1fr)",
        placeItems: "center",
      }}
    >
      {/* The backdrop is the artwork, huge and blurred, dimmed so the white
          text always reads. */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: "-60px",
          backgroundImage: current.artwork ? `url(${current.artwork})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(90px) brightness(0.45) saturate(1.3)",
          transform: "scale(1.15)",
          bgcolor: "background.default",
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at 50% 42%, rgba(0,0,0,0) 0%, rgba(0,0,0,.45) 100%)",
        }}
      />

      {/* Collapse chevron + lyrics toggle, top right like Yandex Music. */}
      <Stack direction="row" spacing={1} sx={{ position: "absolute", top: 24, right: 28, zIndex: 2 }}>
        {hasLyrics && (
          <Tooltip title={lyricsOpen ? "Hide lyrics" : "Show lyrics"}>
            <IconButton
              onClick={() => setLyricsOpen((o) => !o)}
              aria-label="Toggle lyrics"
              sx={{
                // Active: the theme's primary fill with its own contrast
                // color (dark on the lilac Liquid Glass) — white on the
                // light fill is unreadable in dark themes.
                color: lyricsOpen ? "primary.contrastText" : "#fff",
                bgcolor: lyricsOpen ? "primary.main" : "rgba(255,255,255,.12)",
                "&:hover": {
                  bgcolor: lyricsOpen ? "primary.main" : "rgba(255,255,255,.22)",
                  color: lyricsOpen ? "primary.contrastText" : "#fff",
                  filter: "brightness(1.08)",
                },
              }}
            >
              <LyricsIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Back to the player">
          <IconButton
            onClick={onClose}
            aria-label="Close now playing"
            sx={{ color: "#fff", bgcolor: "rgba(255,255,255,.12)", "&:hover": { bgcolor: "rgba(255,255,255,.22)" } }}
          >
            <KeyboardArrowDown />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: { xs: 3, md: 6 },
          flexWrap: "wrap",
          width: "100%",
          px: { xs: 2, md: 6 },
        }}
      >
      <Stack
        spacing={2.5}
        sx={{
          alignItems: "center",
          maxWidth: 560,
          px: 3,
          position: "relative",
          mt: -4,
          // Narrow screens: take the full container width. With the
          // max-content 560px layout the centered flex overflowed to the
          // right and clipped the title (the "shifted right" bug).
          width: { xs: "100%", md: "auto" },
          // Narrow screens: with the lyrics column open the stacked cover
          // block only pushes the lyrics below the fold — show the lyrics
          // alone (the top-right controls stay).
          display: { xs: lyricsOpen ? "none" : "flex", md: "flex" },
        }}
      >
        {/* Cover with the transport revealed on hover / touch. */}
        <Box
          sx={{
            position: "relative",
            width: "min(340px, 70vw)",
            aspectRatio: "1",
            borderRadius: "24px",
            overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,.55)",
            "& .np-transport": { opacity: 0 },
            "&:hover .np-transport": { opacity: 1 },
            ["@media (hover: none)"]: { "& .np-transport": { opacity: 1 } },
          }}
        >
          {current.artwork ? (
            <Box
              component="img"
              src={current.artwork}
              sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: isLoading ? 0.55 : 1 }}
            />
          ) : (
            <Box sx={{ width: "100%", height: "100%", bgcolor: "rgba(255,255,255,.08)", display: "grid", placeItems: "center" }}>
              <GraphicEq sx={{ fontSize: 64, color: "rgba(255,255,255,.6)" }} />
            </Box>
          )}
          {/* Dim only while the transport shows, so the resting view keeps
              the artwork untouched. */}
          <Box
            aria-hidden
            className="np-transport"
            sx={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.55))",
              transition: (t) => t.transitions.create("opacity", { duration: t.transitions.duration.short }),
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              p: 1.5,
            }}
          >
            <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
              {iconBtn("Show the queue", onClose, <MsIcon name="queue_music" fontSize={22} />)}
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ justifyContent: "center", alignItems: "center" }}>
              {iconBtn("Shuffle the queue", onShuffleQueue, <Shuffle fontSize="small" />)}
              {iconBtn("Previous track", onPrevious, <SkipPrevious fontSize="small" />, isLoading || !(state.played?.length > 0))}
              <Tooltip title={paused ? "Resume" : "Pause"}>
                <IconButton
                  onClick={onPauseToggle}
                  aria-label={paused ? "Resume" : "Pause"}
                  disabled={isLoading}
                  sx={{
                    width: 60, height: 60, borderRadius: "50%", mx: 0.5,
                    bgcolor: "primary.main", color: "primary.contrastText",
                    "&:hover": { bgcolor: "primary.main", filter: "brightness(1.08)" },
                  }}
                >
                  {paused || isLoading ? <PlayArrow /> : <Pause />}
                </IconButton>
              </Tooltip>
              {iconBtn("Skip", onSkip, <SkipNext fontSize="small" />, isLoading)}
              {iconBtn(
                `Repeat: ${repeat === "off" ? "off" : repeat === "all" ? "whole queue" : "one track"}`,
                onRepeatCycle,
                repeat === "one" ? <RepeatOne fontSize="small" /> : <Repeat fontSize="small" />,
                false,
                repeat !== "off" ? { color: "primary.light" } : undefined,
              )}
            </Stack>
            <Stack direction="row" sx={{ justifyContent: "center", alignItems: "center", gap: 0.5 }}>
              {iconBtn("Track actions", onMenu, <MsIcon name="more_horiz" fontSize={22} />)}
              {iconBtn(
                favorite ? "Remove from favorites" : "Add to favorites",
                onToggleFavorite,
                <Favorite filled={favorite} fontSize="small" />,
                false,
                favorite ? { color: "primary.light" } : undefined,
              )}
            </Stack>
          </Box>
        </Box>

        <Box sx={{ textAlign: "center", maxWidth: 520, width: "100%", minWidth: 0 }}>
          <Typography variant="h5" noWrap sx={{ color: "#fff", fontWeight: 500, maxWidth: "100%" }}>
            {current.title}
          </Typography>
          <Typography variant="body1" noWrap sx={{ color: "rgba(255,255,255,.72)" }}>
            {[current.author, current.requested_by].filter(Boolean).join(" · ")}
          </Typography>
        </Box>

        {isLive ? (
          <Chip size="small" label="LIVE" color="error" sx={{ height: 22, fontSize: 11 }} />
        ) : (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", width: "min(520px, 86vw)" }}>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,.7)", fontVariantNumeric: "tabular-nums", width: 44, textAlign: "right" }}>
              {fmt(dragMs ?? position)}
            </Typography>
            <Box
              sx={{ flex: 1, py: 1, cursor: "pointer", touchAction: "none" }}
              onPointerDown={(e) => {
                dragRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                setDragMs(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1) * length);
              }}
              onPointerMove={(e) => {
                if (!dragRef.current) return;
                const rect = e.currentTarget.getBoundingClientRect();
                setDragMs(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1) * length);
              }}
              onPointerUp={(e) => {
                if (!dragRef.current) return;
                dragRef.current = false;
                const rect = e.currentTarget.getBoundingClientRect();
                const ms = Math.round(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1) * length);
                setDragMs(null);
                onSeek(ms);
                setLivePos(ms);
              }}
            >
              {/* Same thin seek line as the dock: 4px, rounded, lavender fill. */}
              <Box sx={{ position: "relative", height: 4, borderRadius: 999, bgcolor: "rgba(255,255,255,.25)" }}>
                <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 999, bgcolor: "#fff" }} />
                <Box
                  sx={{
                    position: "absolute", top: "50%", left: `${pct}%`, width: 12, height: 12,
                    transform: "translate(-50%, -50%)", borderRadius: "999px", bgcolor: "#fff",
                  }}
                />
              </Box>
            </Box>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,.7)", fontVariantNumeric: "tabular-nums", width: 44 }}>
              {fmt(length)}
            </Typography>
          </Stack>
        )}
      </Stack>

      {/* Lyrics column, Yandex-Music style: big bold lines on the right,
          the active one lit up; a countdown until the first line starts.
          The fade mask and the huge vertical padding exist to center the
          synced line while scrolling — plain (unsynced) text reads better
          without them. */}
      {lyricsOpen && (
        <Box
          ref={lyricsRef}
          sx={{
            flex: "1 1 380px",
            maxWidth: 640,
            height: "min(76vh, 760px)",
            overflowY: "auto",
            overflowX: "hidden",
            // Wide horizontal padding: the active line scales up 12% and
            // the extra width must stay inside the container, not clip.
            px: 7,
            ...(synced.length > 0
              ? {
                  // Explicit longhands: the `py: "a b c"` shorthand is
                  // invalid for MUI's py (it applies one value to both
                  // sides) and was silently dropped. The generous tail
                  // lets the last lines scroll up out of the bottom fade,
                  // same as the countdown offset at the top.
                  paddingTop: "30vh",
                  paddingBottom: "55vh",
                  maskImage: "linear-gradient(to bottom, transparent, black 12%, black 85%, transparent)",
                  WebkitMaskImage: "linear-gradient(to bottom, transparent, black 12%, black 85%, transparent)",
                }
              : { py: 3 }),
          }}
        >
          {lyricsQuery.isLoading ? (
            <Typography sx={{ textAlign: "center", color: "rgba(255,255,255,.55)", fontSize: 22 }}>
              Looking for lyrics…
            </Typography>
          ) : synced.length > 0 ? (
            <>
              {countdown !== null && (
                <Typography
                  sx={{
                    textAlign: "center",
                    color: "#fff",
                    fontSize: "clamp(28px, 3vw, 40px)",
                    fontWeight: 700,
                    // Same 30vh top offset as the rest of the text.
                    mb: 5,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {countdown}
                </Typography>
              )}
              {synced.map(([sec, text], i) => (
                <Typography
                  key={i}
                  data-active={i === activeLine}
                  onClick={() => onSeek(Math.round(sec * 1000))}
                  sx={{
                    textAlign: "center",
                    cursor: "pointer",
                    color: "#fff",
                    py: 1.6,
                    // Identical font metrics for every line: the wrap point
                    // never moves, so activating a long line cannot reflow
                    // it onto a second row. The karaoke emphasis is a
                    // transform (visual only, no layout) + opacity.
                    fontSize: "clamp(19px, 2vw, 27px)",
                    fontWeight: 600,
                    opacity: i === activeLine ? 1 : 0.32,
                    transform: i === activeLine ? "scale(1.12)" : "scale(1)",
                    transformOrigin: "center",
                    transition: "all .25s",
                    "&:hover": { opacity: i === activeLine ? 1 : 0.55 },
                  }}
                >
                  {text}
                </Typography>
              ))}
            </>
          ) : lyricsQuery.data?.plain ? (
            <Typography sx={{ textAlign: "center", color: "rgba(255,255,255,.8)", whiteSpace: "pre-wrap", fontSize: 20, lineHeight: 1.7 }}>
              {lyricsQuery.data.plain}
            </Typography>
          ) : (
            <Typography sx={{ textAlign: "center", color: "rgba(255,255,255,.5)", fontSize: 18 }}>
              No lyrics found for this track.
            </Typography>
          )}
        </Box>
      )}
      </Box>
    </Box>,
    document.body,
  );
}
