import { useId } from "react";
import { Box } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { LiquidGlassFilter } from "../../components/LiquidGlassFilter";
import type { ExperimentDef } from "../registry";

/**
 * Method 1 — the production approach: an SVG magnifier-pinch displacement
 * map (bounded rim band) applied through a warp layer's `filter`, over a
 * plain backdrop-filter blur/saturate.
 */
function GlassPinch({ params, width, height }: { params: Record<string, number>; width: number; height: number }) {
  const theme = useTheme();
  const id = `pinch-${useId().replace(/:/g, "")}`;
  return (
    <Box sx={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden" }}>
      <LiquidGlassFilter
        id={id}
        width={width}
        height={height}
        radius={params.radius}
        bezel={params.bezel}
        maxDisp={params.maxDisp}
      />
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          bgcolor: alpha(theme.palette.mode === "dark" ? "#181226" : "#ffffff", params.tint),
          backdropFilter: `blur(${params.blur}px) saturate(${params.saturate})`,
          filter: `url(#${id}) contrast(1.15)`,
        }}
      />
    </Box>
  );
}

export const glassPinchDef: ExperimentDef = {
  id: "glass-pinch",
  label: "Glass — SVG pinch",
  defaultSize: { w: 220, h: 150 },
  params: [
    { key: "radius", label: "Corner radius", min: 8, max: 60, step: 1, default: 24 },
    { key: "maxDisp", label: "Lens strength, px", min: 0, max: 36, step: 1, default: 14 },
    { key: "bezel", label: "Lens band, px", min: 6, max: 40, step: 1, default: 20 },
    { key: "blur", label: "Blur, px", min: 0, max: 10, step: 0.5, default: 3 },
    { key: "saturate", label: "Saturate", min: 1, max: 2, step: 0.05, default: 1.4 },
    { key: "tint", label: "Tint opacity", min: 0, max: 0.6, step: 0.05, default: 0.35 },
  ],
  Component: GlassPinch,
};
