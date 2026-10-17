import { Box, type SxProps, type Theme } from "@mui/material";

/**
 * One glyph of Material Symbols Rounded (https://fonts.google.com/icons),
 * served from the local subset in /fonts. `name` is the icon ligature,
 * e.g. "left_panel_close". Filled style, matching the MUI filled icons
 * used elsewhere.
 */
export function MsIcon({
  name,
  fontSize = 24,
  sx,
}: {
  name: string;
  fontSize?: number | string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={[
        {
          fontFamily: '"Material Symbols Rounded"',
          fontWeight: 400,
          fontStyle: "normal",
          fontSize,
          lineHeight: 1,
          letterSpacing: "normal",
          textTransform: "none",
          display: "inline-block",
          whiteSpace: "nowrap",
          wordWrap: "normal",
          direction: "ltr",
          fontFeatureSettings: '"liga"',
          fontVariationSettings: '"FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24',
          WebkitFontSmoothing: "antialiased",
          userSelect: "none",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {name}
    </Box>
  );
}
