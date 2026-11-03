import { useState } from "react";
import { Box, type BoxProps } from "@mui/material";
import { IconMusicNote as MusicNote } from "../icons";

/** Track cover image with a graceful fallback: a dead artwork url (radio
    station favicons die all the time) swaps to the music-note placeholder
    tile instead of rendering a broken image and spamming the console. */
export function CoverImg({
  src, size, radius = "8px", sx,
}: {
  src: string | null | undefined;
  size: number;
  radius?: string;
  sx?: BoxProps["sx"];
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <Box
        sx={[
          {
            width: size,
            height: size,
            borderRadius: radius,
            bgcolor: (t) => t.palette.m3.surfaceContainerHigh,
            display: "grid",
            placeItems: "center",
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <MusicNote sx={{ color: "text.secondary" }} />
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={src}
      onError={() => setBroken(true)}
      sx={{ display: "block", width: size, height: size, borderRadius: radius, objectFit: "cover", ...sx }}
    />
  );
}
