import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { IconAddToQueue as AddQueue, IconFavorite as Favorite, IconSearch as SearchIcon, IconPlayArrow as PlayArrow, IconGraphicEq as GraphicEq } from "../icons";
import { MsIcon } from "../MsIcon";
import { PlaylistAddMenu } from "../PlaylistAddMenu";
import { MosaicCover } from "../MosaicCover";
import { RowActions, rowActionsRowSx } from "./RowActions";
import { CoverImg } from "./CoverImg";
import { fmt, SOURCE_LABELS } from "./labels";
import type { SearchTabProps } from "./playerProps";

/** The sticky search header of the player home: field + Queue URL + source
    chips (+ radio presets / upload). It stays put while the page scrolls
    underneath, like Yandex Music's top search. */
export function SearchBar({
  gid, source, setSource, query, setQuery, performer, setPerformer, hasQuery, searchActive, setSearchActive,
  setResults, searching, enqueueing, enqueue, doSearch, sourceAvailable,
  uploading, fileInputRef, uploadFiles, onPreset, guard,
  SOURCES, PLACEHOLDERS, RADIO_PRESETS, UPLOAD_ACCEPT,
}: Omit<SearchTabProps, "results" | "favorites" | "played" | "myPls" | "toggleFavorite" | "onOpenCollection" | "onOpenHistory">) {
  void gid; void guard;
  // The frosted backdrop only exists while the page is scrolled: at rest
  // the bar is fully transparent and covers nothing.
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const scroller = rootRef.current?.closest("main");
    if (!scroller) return;
    const onScroll = () => setScrolled((scroller as HTMLElement).scrollTop > 4);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  // Backdrop fade: the whole padding band dissolves toward every edge
  // (fully frosted past the padding, zero right at the rim), so there is
  // no hard rim on any of the four sides.
  const pad = 24;
  const edgeMask = `linear-gradient(to right, transparent 0px, black ${pad}px, black calc(100% - ${pad}px), transparent 100%), linear-gradient(to bottom, transparent 0px, black ${pad}px, black calc(100% - ${pad}px), transparent 100%)`;
  return (
    <Box ref={rootRef} sx={{ position: "sticky", top: 0, zIndex: 5, p: { xs: 1.5, md: 3 } }}>
      <Box
        aria-hidden
        sx={(t) => ({
          position: "absolute",
          inset: 0,
          borderRadius: "16px",
          overflow: "hidden",
          backdropFilter: "blur(16px) saturate(1.5)",
          bgcolor: t.palette.mode === "dark" ? "rgba(14,10,26,.35)" : "rgba(255,255,255,.35)",
          maskImage: edgeMask,
          WebkitMaskImage: edgeMask,
          maskComposite: "intersect",
          WebkitMaskComposite: "source-in",
          // Fade the whole layer in/out instead of popping it.
          opacity: scrolled ? 1 : 0,
          transition: (tt) => tt.transitions.create("opacity", { duration: tt.transitions.duration.standard, easing: "ease" }),
          pointerEvents: "none",
        })}
      />
      <Box sx={{ position: "relative" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
        <Box sx={{ position: "relative", flex: 1, minWidth: 0 }}>
          <TextField
            fullWidth
            placeholder={performer ? "Artist name — tracks by this performer only" : PLACEHOLDERS[source]}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchActive(true)}
            onBlur={() => setSearchActive(false)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            sx={{
              // Text clears the magnifier slot it currently sits in.
              "& .MuiOutlinedInput-input": {
                pl: searchActive || hasQuery ? 1.75 : 5.5,
                pr: searchActive || hasQuery ? 5.5 : 1.75,
                transition: (tt) => tt.transitions.create("padding", { duration: tt.transitions.duration.short }),
              },
            }}
          />
          {/* One magnifier for all three states: a left marker while the
              field is idle, an indicator on the right once the field is
              active, the search action when there is a query. */}
          <Box
            sx={{
              position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)",
              display: "flex", pointerEvents: "none",
              opacity: searchActive || hasQuery ? 0 : 1,
              transition: (tt) => tt.transitions.create(["opacity", "transform"], { duration: tt.transitions.duration.short }),
            }}
          >
            <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
          </Box>
          <Box
            sx={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              display: "flex",
              pointerEvents: searchActive || hasQuery ? "auto" : "none",
              opacity: searchActive || hasQuery ? 1 : 0,
              transition: (tt) => tt.transitions.create(["opacity", "transform"], { duration: tt.transitions.duration.short }),
            }}
          >
            <Tooltip title={hasQuery ? "Search" : ""}>
              <IconButton
                aria-hidden={!hasQuery}
                aria-label={hasQuery ? "Search" : undefined}
                tabIndex={hasQuery ? 0 : -1}
                onClick={hasQuery ? () => doSearch() : undefined}
                disabled={searching}
                sx={{ color: hasQuery ? undefined : "text.secondary" }}
              >
                {searching ? <CircularProgress size={18} /> : <SearchIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Tooltip title="Add the link to the queue without searching">
          <Button
            variant="tonal"
            sx={{ height: 40, flexShrink: 0, width: { xs: "100%", sm: "auto" }, minWidth: 40 }}
            disabled={!query.trim() || enqueueing !== null}
            onClick={() => query.trim() && enqueue("url", { query, source })}
          >
            {enqueueing === "url" ? <CircularProgress size={16} /> : <AddQueue fontSize="small" />}
            <Box component="span" sx={{ display: { xs: "inline", sm: "none", xl: "inline" }, ml: 0.75 }}>
              Queue URL
            </Box>
          </Button>
        </Tooltip>
        {source === "local" && (
          <>
            <Tooltip title="Upload your own audio file (mp3, ogg, flac, m4a, wav, opus)">
              <Button
                variant="tonal"
                sx={{ height: 40, flexShrink: 0, width: { xs: "100%", sm: "auto" }, minWidth: 40 }}
                disabled={uploading !== null}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <CircularProgress size={16} /> : <MsIcon name="upload" fill={false} fontSize={20} />}
                <Box component="span" sx={{ display: { xs: "inline", sm: "none", xl: "inline" }, ml: 0.75 }}>
                  {uploading ? "Uploading…" : "Upload audio"}
                </Box>
              </Button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              hidden
              onChange={(e) => uploadFiles(e.target.files)}
            />
          </>
        )}
      </Stack>

      {/* Source chips: the Yandex-Music style filter row under the field. */}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          flexWrap: { xs: "nowrap", sm: "wrap" },
          overflowX: { xs: "auto", sm: "visible" },
          mt: 1,
          rowGap: 1,
          pb: { xs: 0.5, sm: 0 },
        }}
      >
        {SOURCES.map((s) => {
          const available = sourceAvailable(s.id);
          const chip = (
            <Chip
              icon={s.icon as React.ReactElement}
              label={s.label}
              clickable
              disabled={!available}
              color={source === s.id ? "primary" : "default"}
              variant={source === s.id ? "filled" : "outlined"}
              onClick={() => {
                setSource(s.id);
                setResults(null);
              }}
              sx={{ flexShrink: 0 }}
            />
          );
          // A Box wrapper keeps hover events alive on the disabled chip.
          return available ? chip : (
            <Tooltip key={s.id} title="Source is unreachable from the server right now">
              <Box sx={{ display: "inline-flex", flexShrink: 0 }}>{chip}</Box>
            </Tooltip>
          );
        })}
        {/* Artist mode: keep only rows whose author matches the query — a
            band name no longer returns unrelated tracks sharing its title. */}
        <Chip
          icon={<GraphicEq fontSize="small" />}
          label="Artist"
          clickable
          color={performer ? "secondary" : "default"}
          variant={performer ? "filled" : "outlined"}
          onClick={() => {
            setPerformer(!performer);
            setResults(null);
          }}
          sx={{ flexShrink: 0 }}
        />
      </Stack>

      {source === "radio" && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            flexWrap: { xs: "nowrap", sm: "wrap" },
            overflowX: { xs: "auto", sm: "visible" },
            mt: 1,
            rowGap: 1,
            pb: { xs: 0.5, sm: 0 },
          }}
        >
          {RADIO_PRESETS.map((preset) => (
            <Chip
              key={preset}
              label={preset}
              size="small"
              variant="outlined"
              sx={{ flexShrink: 0 }}
              onClick={() => onPreset(preset)}
            />
          ))}
        </Stack>
      )}
      </Box>
    </Box>
  );
}

/** A cover-art card of the horizontal home rails (favorites, playlists,
    recently played). The hover play badge is decorative: the whole card
    clicks. An optional queue badge (the smaller disc on the left) adds the
    "enqueue without playing" action. */
export function MediaCard({
  title, subtitle, artwork, artworks, onClick, onQueue, onMenu,
}: {
  title: string;
  subtitle?: string;
  artwork?: string | null;
  /** Playlist-style mosaic of up to 4 covers (overrides artwork). */
  artworks?: string[];
  onClick?: () => void;
  onQueue?: () => void;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  const theme = useTheme();
  const glyphColor = theme.palette.mode === "dark" ? "#362268" : theme.palette.m3.onPrimary;
  return (
    <Box onClick={onClick} onContextMenu={onMenu} sx={{ width: 148, flexShrink: 0, cursor: "pointer", "&:hover .card-play": { opacity: 1 } }}>
      <Box sx={{ position: "relative" }}>
        {artworks && artworks.length > 0 ? (
          <MosaicCover images={artworks} size={148} />
        ) : (
          <CoverImg src={artwork} size={148} radius="12px" />
        )}
        {onQueue && (
          <Box
            className="card-play"
            onClick={(e) => {
              e.stopPropagation();
              onQueue();
            }}
            sx={{
              position: "absolute", right: 52, bottom: 8,
              width: 36, height: 36, borderRadius: "50%",
              bgcolor: "rgba(20,16,32,.72)", display: "grid", placeItems: "center",
              opacity: 0,
              transition: (tt) => tt.transitions.create("opacity", { duration: tt.transitions.duration.short }),
              boxShadow: "0 4px 12px rgba(0,0,0,.4)",
            }}
          >
            <AddQueue fontSize="small" sx={{ color: "#fff" }} />
          </Box>
        )}
        <Box
          className="card-play"
          sx={(t) => ({
            position: "absolute", right: 8, bottom: 8,
            width: 36, height: 36, borderRadius: "50%",
            bgcolor: t.palette.primary.main, display: "grid", placeItems: "center",
            opacity: 0,
            transition: (tt) => tt.transitions.create("opacity", { duration: tt.transitions.duration.short }),
            boxShadow: "0 4px 12px rgba(0,0,0,.4)",
          })}
        >
          {/* Dark glyph on the light lavender disc in dark themes (the Join
              button does the same): some glass schemes ship a light
              onPrimary, so the token alone is not enough contrast. */}
          <PlayArrow fontSize="small" sx={{ color: glyphColor }} />
        </Box>
      </Box>
      <Typography variant="body2" noWrap sx={{ mt: 0.75 }}>{title}</Typography>
      {subtitle && (
        <Typography variant="caption" noWrap sx={{ color: "text.secondary", display: "block" }}>
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

/** A titled horizontal rail of media cards (the Yandex-Music home block). */
export function HomeRail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1.25, fontWeight: 500 }}>{title}</Typography>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ overflowX: "auto", pb: 1 }}>
        {children}
      </Stack>
    </Box>
  );
}

/** Banner shown while cached results are already on screen and a forced
    re-search runs. Same card surface as the rest of the panel (Queue,
    Voice connection) with the sidebar's rounded progress bar. */
function SearchingBanner() {
  return (
    <Card sx={{ mb: 1.5 }}>
      <CardContent sx={{ py: 1.5, px: 2.5, "&:last-child": { pb: 1.5 } }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <LinearProgress sx={{ width: 140, height: 4, borderRadius: 999, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }}>
              Searching for audio…
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.3 }}>
              Fresh results are loading — the list below is your recent search
              from the cache.
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Search results list under the sticky bar (renders only with a query). */
export function SearchResults({
  results, searching, favorites, toggleFavorite, enqueue, enqueueing, onMenu,
}: Pick<SearchTabProps, "results" | "searching" | "favorites" | "toggleFavorite" | "enqueue" | "enqueueing"> & {
  onMenu: (e: React.MouseEvent, spec: import("../TrackMenu").TrackMenuSpec) => void;
}) {
  if (!results) {
    // First-ever search for this query: nothing cached to show, skeletons only.
    if (searching) {
      return (
        <Box sx={{ mt: 1 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ display: "flex", gap: 2, py: 1 }}>
              <Skeleton variant="rounded" width={48} height={48} />
              <Box sx={{ flex: 1 }}>
                <Skeleton width="70%" />
                <Skeleton width="40%" />
              </Box>
            </Box>
          ))}
        </Box>
      );
    }
    return null;
  }
  return (
    <Box>
      {/* Stale-while-revalidate: cached rows stay on screen under the banner
          while the forced re-search runs. */}
      {searching && <SearchingBanner />}
      {results.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
          Nothing found.
        </Typography>
      ) : (
        <List disablePadding>
      {results.map((t, i) => (
        <ListItem
          key={i}
          disablePadding
          // Row click adds to the queue, same as the Queue button; play now
          // stays in the context menu. Hover/active match the other lists.
          onClick={() => {
            enqueue(
              `t${i}`,
              t.encoded
                ? { encoded: t.encoded, source: t.source ?? "" }
                : { query: t.uri ?? t.title, source: t.source ?? "" },
            );
          }}
          sx={{
            cursor: "pointer",
            borderRadius: 1,
            // Vertical centering makes the cover's top/bottom gaps equal;
            // the ListItemText's own 4px vertical margins are zeroed so the
            // visual insets match the 12px sides exactly.
            alignItems: "center",
            px: 1.5,
            py: 1.5,
            "& .MuiListItemText-root": { my: 0 },
            "&:hover": { bgcolor: "action.hover" },
            "&:active": { bgcolor: "action.selected" },
            // Actions live in a hover-only pill, so long titles run wide.
            ...rowActionsRowSx,
          }}
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
              onQueue: () => {
                enqueue(
                  `t${i}`,
                  t.encoded
                    ? { encoded: t.encoded, source: t.source ?? "" }
                    : { query: t.uri ?? t.title, source: t.source ?? "" },
                );
              },
            })
          }
          secondaryAction={
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center" }}
              // Action clicks must not bubble into the row's enqueue onClick.
              onClick={(e) => e.stopPropagation()}
            >
              {t.issue && (
                <Chip size="small" label={t.issue.toUpperCase()} color="error" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
              )}
              {/* Hover-only frosted pill: the title is never covered at rest. */}
              <RowActions>
                <Tooltip title={favorites.some((f) => f.uri === t.uri) ? "Remove from favorites" : "Add to favorites"}>
                  <IconButton size="small" onClick={() => toggleFavorite(t)}>
                    <Favorite filled={favorites.some((f) => f.uri === t.uri)} fontSize="small" />
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
                <Button
                  size="small"
                  variant="tonal"
                  disabled={enqueueing !== null}
                  startIcon={enqueueing === `t${i}` ? <CircularProgress size={14} /> : undefined}
                  onClick={() => {
                    enqueue(
                      `t${i}`,
                      t.encoded
                        ? { encoded: t.encoded, source: t.source ?? "" }
                        : { query: t.uri ?? t.title, source: t.source ?? "" },
                    );
                  }}
                >
                  Queue
                </Button>
              </RowActions>
            </Stack>
          }
        >
          <ListItemAvatar>
            <CoverImg src={t.artwork} size={48} />
          </ListItemAvatar>
          <ListItemText
            primary={t.title}
            secondary={[
              SOURCE_LABELS[t.source ?? ""] ?? "",
              t.author ?? "",
              t.length > 0 ? fmt(t.length) : t.source === "local" ? "file" : "LIVE",
            ].filter(Boolean).join(" · ")}
            slotProps={{
              primary: { noWrap: true, sx: { pr: 2 } },
              secondary: { noWrap: true, sx: { pr: 2 } },
            }}
          />
        </ListItem>
      ))}
        </List>
      )}
    </Box>
  );
}
