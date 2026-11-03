import { Box } from "@mui/material";
import { CoverImg } from "./player/CoverImg";

/** Playlist cover built from up to 4 track artworks (Spotify-style):
    1 image fills the tile; 2 split it into left/right halves; 3 put one
    half-height-spanning image on the left and two stacked on the right;
    4 form a 2x2 grid. Half-width tiles read as center crops because every
    image uses object-fit: cover. Fewer images than 4 simply fall back to
    the matching layout, and an empty list renders the single placeholder
    tile (via CoverImg's broken-image fallback). */
export function MosaicCover({
  images, size, radius = "12px",
}: {
  images: (string | null | undefined)[];
  size: number;
  radius?: string;
}) {
  const tiles = (images ?? []).filter((x): x is string => !!x).slice(0, 4);
  const half = size / 2;
  const cell = (src: string, key: string | number) => (
    <CoverImg key={key} src={src} size={Math.round(half)} radius="0" sx={{ width: "100%", height: "100%" }} />
  );

  let grid: React.ReactNode;
  if (tiles.length <= 1) {
    grid = <CoverImg src={tiles[0] ?? null} size={size} radius="0" sx={{ width: "100%", height: "100%" }} />;
  } else if (tiles.length === 2) {
    grid = (
      <>
        <Box sx={{ gridColumn: "1", gridRow: "1", overflow: "hidden" }}>{cell(tiles[0], "a")}</Box>
        <Box sx={{ gridColumn: "2", gridRow: "1", overflow: "hidden" }}>{cell(tiles[1], "b")}</Box>
      </>
    );
  } else if (tiles.length === 3) {
    grid = (
      <>
        <Box sx={{ gridColumn: "1", gridRow: "1 / span 2", overflow: "hidden" }}>{cell(tiles[0], "a")}</Box>
        <Box sx={{ gridColumn: "2", gridRow: "1", overflow: "hidden" }}>{cell(tiles[1], "b")}</Box>
        <Box sx={{ gridColumn: "2", gridRow: "2", overflow: "hidden" }}>{cell(tiles[2], "c")}</Box>
      </>
    );
  } else {
    grid = tiles.map((src, i) => (
      <Box key={i} sx={{ gridColumn: (i % 2) + 1, gridRow: Math.floor(i / 2) + 1, overflow: "hidden" }}>
        {cell(src, i)}
      </Box>
    ));
  }

  return (
    <Box
      sx={{
        width: size,
        height: size,
        display: "grid",
        gridTemplateColumns: tiles.length === 1 ? "1fr" : "1fr 1fr",
        gridTemplateRows: tiles.length === 2 ? "1fr" : "1fr 1fr",
        borderRadius: radius,
        overflow: "hidden",
        bgcolor: (t) => t.palette.m3.surfaceContainerHigh,
        flexShrink: 0,
      }}
    >
      {grid}
    </Box>
  );
}
