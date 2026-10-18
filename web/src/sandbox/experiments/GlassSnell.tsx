import { useId, useMemo } from "react";
import { Box } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ExperimentDef } from "../registry";

const MAP = 512;
const mapCache = new Map<string, string>();

function roundedRectSdf(x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Snell-profile displacement map (kube.io): a single air->glass
 * refraction over an Apple squircle bezel; magnitude bounded by the bezel
 * depth, direction along the rim normal. Encoded 128 = neutral.
 */
function buildSnellMap(w: number, h: number, radius: number, bezel: number, maxDisp: number): string {
  const key = `${Math.round(w)}x${Math.round(h)}r${radius}b${bezel}m${maxDisp}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = MAP;
  canvas.height = MAP;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(MAP, MAP);
  const data = img.data;
  const n = 1.5;
  const heightAt = (t: number) => Math.pow(1 - Math.pow(1 - t, 4), 0.25);
  const offsetAt = (t: number) => {
    const eps = 0.001;
    const slope = (heightAt(t + eps) - heightAt(t)) / eps;
    const sinIn = slope / Math.hypot(1, slope);
    return sinIn - sinIn / n;
  };
  const peak = offsetAt(0) || 1;
  for (let j = 0; j < MAP; j++) {
    for (let i = 0; i < MAP; i++) {
      const idx = j * MAP + i;
      const x = ((i + 0.5) / MAP) * w;
      const y = ((j + 0.5) / MAP) * h;
      const d = -roundedRectSdf(x, y, w, h, radius);
      if (d <= 0 || d >= bezel) continue;
      const cx = w / 2 - x;
      const cy = h / 2 - y;
      const len = Math.hypot(cx, cy) || 1;
      const mag = Math.min((offsetAt(d / bezel) / peak) * maxDisp, maxDisp);
      data[idx * 4] = Math.round(128 + (cx / len) * (mag / maxDisp) * 127);
      data[idx * 4 + 1] = Math.round(128 + (cy / len) * (mag / maxDisp) * 127);
      data[idx * 4 + 2] = 128;
      data[idx * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (mapCache.size > 24) mapCache.clear();
  mapCache.set(key, url);
  return url;
}

const CHANNEL_ISOLATE = {
  red: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  green: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  blue: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
};

/**
 * Method 2 — kube.io Snell refraction with chromatic aberration: three
 * displacement passes at stepped scales, per-channel isolation and a
 * screen recombine; a specular gradient ring finishes the read.
 */
function GlassSnell({ params, width, height }: { params: Record<string, number>; width: number; height: number }) {
  const id = `snell-${useId().replace(/:/g, "")}`;
  const map = useMemo(
    () => buildSnellMap(width, height, params.radius, params.bezel, params.maxDisp),
    [width, height, params.radius, params.bezel, params.maxDisp],
  );
  const s = params.maxDisp;
  const ab = params.aberration;
  return (
    <Box sx={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden" }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
        <defs>
          <filter
            id={id}
            x={-40}
            y={-40}
            width={Math.round(width) + 80}
            height={Math.round(height) + 80}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage href={map} x={0} y={0} width={Math.round(width)} height={Math.round(height)} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={s} xChannelSelector="R" yChannelSelector="G" result="dR" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={Math.max(0, s - ab * 0.5)} xChannelSelector="R" yChannelSelector="G" result="dG" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={Math.max(0, s - ab)} xChannelSelector="R" yChannelSelector="G" result="dB" />
            <feColorMatrix in="dR" type="matrix" values={CHANNEL_ISOLATE.red} result="cR" />
            <feColorMatrix in="dG" type="matrix" values={CHANNEL_ISOLATE.green} result="cG" />
            <feColorMatrix in="dB" type="matrix" values={CHANNEL_ISOLATE.blue} result="cB" />
            <feBlend in="cR" in2="cG" mode="screen" result="rg" />
            <feBlend in="rg" in2="cB" mode="screen" />
          </filter>
        </defs>
      </svg>
      <Box
        aria-hidden
        sx={(t) => ({
          position: "absolute",
          inset: 0,
          bgcolor: alpha(t.palette.mode === "dark" ? "#181226" : "#ffffff", params.tint),
          backdropFilter: `blur(${params.blur}px) saturate(${params.saturate})`,
          filter: `url(#${id}) contrast(1.12) brightness(1.04)`,
        })}
      />
      {/* Specular gradient ring (1.5px, masked to the border). */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          p: "1.5px",
          pointerEvents: "none",
          background: `linear-gradient(135deg, ${alpha("#ffffff", 0.45)}, ${alpha("#ffffff", 0.08)} 45%, ${alpha("#c9b6ff", 0.3)})`,
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
    </Box>
  );
}

export const glassSnellDef: ExperimentDef = {
  id: "glass-snell",
  label: "Glass — SVG Snell + aberration",
  defaultSize: { w: 220, h: 150 },
  params: [
    { key: "radius", label: "Corner radius", min: 8, max: 60, step: 1, default: 24 },
    { key: "maxDisp", label: "Lens strength, px", min: 0, max: 36, step: 1, default: 12 },
    { key: "bezel", label: "Lens band, px", min: 6, max: 40, step: 1, default: 24 },
    { key: "aberration", label: "Aberration", min: 0, max: 6, step: 0.5, default: 2 },
    { key: "blur", label: "Blur, px", min: 0, max: 10, step: 0.5, default: 2 },
    { key: "saturate", label: "Saturate", min: 1, max: 2, step: 0.05, default: 1.4 },
    { key: "tint", label: "Tint opacity", min: 0, max: 0.6, step: 0.05, default: 0.3 },
  ],
  Component: GlassSnell,
};
