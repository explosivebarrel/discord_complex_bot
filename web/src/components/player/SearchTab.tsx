import { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { IconAddToQueue as AddQueue, IconFavorite as Favorite, IconSearch as SearchIcon, IconMusicNote as MusicNote, IconPlayArrow as PlayArrow } from "../icons";
import { MsIcon } from "../MsIcon";
import { PlaylistAddMenu } from "../PlaylistAddMenu";
import { fmt, SOURCE_LABELS } from "./labels";
import type { SearchTabProps } from "./playerProps";

/** The sticky search header of the player home: field + Queue URL + source
    chips (+ radio presets / upload). It stays put while the page scrolls
    underneath, like Yandex Music's top search. */
export function SearchBar({
  gid, source, setSource, query, setQuery, hasQuery, searchActive, setSearchActive,
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
  // Backdrop fade: fully frosted in the middle, dissolving to nothing at
  // the block edges so there is no hard rim.
  // The fade band spans the block padding: fully frosted in the middle,
  // dissolving to nothing half a padding before the edge, per the design.
  const pad = 24;
  const fade = pad / 2;
  const edgeMask = `linear-gradient(to right, black 0px, black calc(100% - ${fade}px), transparent 100%), linear-gradient(to bottom, black 0px, black calc(100% - ${fade}px), transparent 100%)`;
  return (
    <Box ref={rootRef} sx={{ position: "sticky", top: 0, zIndex: 5, p: { xs: 1.5, md: 3 } }}>
      {scrolled && (
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
          })}
        />
      )}
      <Box sx={{ position: "relative" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "stretch", sm: "center" } }}>
        <Box sx={{ position: "relative", flex: 1, minWidth: 0 }}>
          <TextField
            fullWidth
            placeholder={PLACEHOLDERS[source]}
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
    clicks. */
export function MediaCard({
  title, subtitle, artwork, onClick,
}: {
  title: string;
  subtitle?: string;
  artwork?: string | null;
  onClick?: () => void;
}) {
  return (
    <Box onClick={onClick} sx={{ width: 148, flexShrink: 0, cursor: "pointer", "&:hover .card-play": { opacity: 1 } }}>
      <Box sx={{ position: "relative" }}>
        {artwork ? (
          <Box component="img" src={artwork} sx={{ width: 148, height: 148, borderRadius: "12px", objectFit: "cover" }} />
        ) : (
          <Box
            sx={(t) => ({
              width: 148, height: 148, borderRadius: "12px",
              bgcolor: t.palette.m3.surfaceContainerHigh, display: "grid", placeItems: "center",
            })}
          >
            <MusicNote sx={{ color: "text.secondary", fontSize: 40 }} />
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
          <PlayArrow fontSize="small" />
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

/** Search results list under the sticky bar (renders only with a query). */
export function SearchResults({
  results, searching, favorites, toggleFavorite, enqueue, enqueueing,
}: Pick<SearchTabProps, "results" | "searching" | "favorites" | "toggleFavorite" | "enqueue" | "enqueueing">) {
  if (!results) return null;
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
  if (results.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary", py: 3, textAlign: "center" }}>
        Nothing found.
      </Typography>
    );
  }
  return (
    <List disablePadding sx={{ mt: 1 }}>
      {results.map((t, i) => (
        <ListItem
          key={i}
          disablePadding
          secondaryAction={
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Tooltip title={favorites.some((f) => f.uri === t.uri) ? "Remove from favorites" : "Add to favorites"}>
                <IconButton size="small" onClick={() => toggleFavorite(t)}>
                  <Favorite filled={favorites.some((f) => f.uri === t.uri)} fontSize="small" />
                </IconButton>
              </Tooltip>
              {t.issue && (
                <Chip size="small" label={t.issue.toUpperCase()} color="error" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
              )}
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
            </Stack>
          }
        >
          <ListItemAvatar>
            {t.artwork ? (
              <Box component="img" src={t.artwork} sx={{ width: 48, height: 48, borderRadius: "8px", objectFit: "cover" }} />
            ) : (
              <Box
                sx={(t) => ({
                  width: 48, height: 48, borderRadius: "8px",
                  bgcolor: t.palette.m3.surfaceContainerHigh, display: "grid", placeItems: "center",
                })}
              >
                <MusicNote sx={{ color: "text.secondary" }} />
              </Box>
            )}
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
  );
}
