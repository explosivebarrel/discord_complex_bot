import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { ExperimentDef } from "../registry";

/**
 * Status-strip rendering shootout. Four renderers draw the same synthetic
 * availability data into the same box so the differences are visible at a
 * glance; resizing the card (Width/Height in the inspector) shows how each
 * behaves when the outer container changes size.
 *
 * The problem being investigated: CSS-flex segments get fractional widths
 * (e.g. 554px / 60 ≈ 8.28px), the browser snaps their edges to the pixel
 * grid unevenly, and the 1px gap between same-colored neighbors visually
 * disappears for some pairs.
 */

// Deterministic pseudo-random station data: mostly up, sprinkled with
// degraded/down/gap runs so the strips have recognizable shapes.
const UP = 2, DEGRADED = 1, DOWN = 0, GAP = -1;

function sampleData(count: number): number[] {
  const out: number[] = [];
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let i = 0;
  // Leading "not monitored yet" gap.
  const lead = Math.floor(count * 0.12);
  while (i < lead) { out.push(GAP); i++; }
  while (i < count) {
    const r = rnd();
    if (r < 0.82) out.push(UP);
    else if (r < 0.9) out.push(DEGRADED);
    else if (r < 0.96) out.push(DOWN);
    else {
      // A short outage run.
      let run = 2 + Math.floor(rnd() * 4);
      while (run > 0 && i < count) { out.push(GAP); i++; run--; }
      continue;
    }
    i++;
  }
  return out;
}

const COLORS: Record<number, string> = {
  [UP]: "#6DD58C",
  [DEGRADED]: "#FFA738",
  [DOWN]: "#E5484D",
  [GAP]: "rgba(148,143,153,.14)",
};

/** Shared canvas painter: integer-pixel rect runs. */
function paintCanvas(
  canvas: HTMLCanvasElement,
  data: number[],
  gap: number,
  aggregate: boolean,
) {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx || cssW <= 0) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  let values = data;
  if (aggregate) {
    // Integer pitch: pick a segment width that divides the box evenly,
    // then fold the data into that many buckets.
    const maxSegs = Math.max(8, Math.floor(cssW / (2 + gap)));
    const n = Math.min(values.length, maxSegs);
    values = Array.from({ length: n }, (_, i) => {
      const from = Math.floor((i * data.length) / n);
      const to = Math.max(from + 1, Math.floor(((i + 1) * data.length) / n));
      let worst = GAP;
      for (let j = from; j < to && j < data.length; j++) worst = Math.max(worst, data[j]);
      return worst;
    });
  }

  const slot = cssW / values.length;
  const segW = Math.max(1, Math.floor(slot) - gap);
  for (let i = 0; i < values.length; i++) {
    const x = Math.round(i * (segW + gap));
    ctx.fillStyle = COLORS[values[i]];
    // Integer coordinates only: no subpixel edge, no antialiased smear.
    ctx.fillRect(x, 0, segW, Math.round(cssH));
  }
}

/** The four strips on one card. */
function StripRender({ params }: { params: Record<string, number> }) {
  const theme = useTheme();
  const data = sampleData(params.segments);
  const boxW = Math.max(120, params.boxWidth);
  const boxH = Math.max(12, params.boxHeight);
  const gap = params.gap;

  const intRef = useRef<HTMLCanvasElement | null>(null);
  const pitchRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (intRef.current) paintCanvas(intRef.current, data, gap, false);
    if (pitchRef.current) paintCanvas(pitchRef.current, data, gap, true);
  }); // no deps: repaint on every render (params change → render)

  const cssStrip = (
    <Box sx={{ display: "flex", gap: "1px", height: boxH, width: "100%", minWidth: 0 }}>
      {data.map((v, i) => (
        <Box
          key={i}
          sx={{
            flex: "1 1 0%",
            minWidth: 0,
            height: "100%",
            borderRadius: 1,
            bgcolor: COLORS[v],
          }}
        />
      ))}
    </Box>
  );

  const svgStrip = (() => {
    const slot = boxW / data.length;
    const segW = Math.max(1, Math.round(slot) - gap);
    return (
      <svg width="100%" height={boxH} viewBox={`0 0 ${boxW} ${boxH}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {data.map((v, i) => (
          <rect key={i} x={Math.round(i * (segW + gap))} y={0} width={segW} height={boxH} fill={COLORS[v]} />
        ))}
      </svg>
    );
  })();

  const rows: { label: string; node: React.ReactNode }[] = [
    { label: "1. CSS flex (production)", node: cssStrip },
    { label: "2. SVG integer x", node: svgStrip },
    { label: "3. Canvas integer", node: <canvas ref={intRef} style={{ width: "100%", height: boxH, display: "block" }} /> },
    { label: "4. Canvas integer pitch (aggregated)", node: <canvas ref={pitchRef} style={{ width: "100%", height: boxH, display: "block" }} /> },
  ];

  return (
    <Box sx={{ position: "absolute", inset: 0, p: 1, overflow: "hidden", bgcolor: theme.palette.background.paper }}>
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
        Resize the card (inspector W/H) to compare renderers
      </Typography>
      <Box sx={{ width: boxW, border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
        {rows.map((r) => (
          <Box key={r.label} sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
              {r.label}
            </Typography>
            {r.node}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export const stripRenderDef: ExperimentDef = {
  id: "strip-render",
  label: "Strip — render shootout",
  defaultSize: { w: 420, h: 260 },
  params: [
    { key: "boxWidth", label: "Strip box width, px", min: 120, max: 700, step: 1, default: 320 },
    { key: "boxHeight", label: "Strip height, px", min: 8, max: 32, step: 1, default: 16 },
    { key: "segments", label: "Segments", min: 20, max: 120, step: 1, default: 60 },
    { key: "gap", label: "Gap, px", min: 0, max: 4, step: 1, default: 1 },
  ],
  Component: StripRender,
};
