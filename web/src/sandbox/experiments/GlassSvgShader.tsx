import { useId, useMemo } from "react";
import { Box } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { ExperimentDef } from "../registry";

const MAP = 512;
const mapCache = new Map<string, string>();

function roundedRectSdf(x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Magnifier displacement map: rim band pulls samples toward the center,
    magnitude capped at maxDisp with a smooth falloff (the GLSL model). */
function buildDisplacementMap(w: number, h: number, radius: number, bezel: number, maxDisp: number): string {
  const key = `d${Math.round(w)}x${Math.round(h)}r${radius}b${bezel}m${maxDisp}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = MAP;
  canvas.height = MAP;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(MAP, MAP);
  const data = img.data;
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
      // Peak at the very edge, easing to zero at the band's inner boundary.
      const m = maxDisp * Math.pow(1 - d / bezel, 1.25);
      data[idx * 4] = Math.round(128 + (cx / len) * (m / maxDisp) * 127);
      data[idx * 4 + 1] = Math.round(128 + (cy / len) * (m / maxDisp) * 127);
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

/** Specular map replicating the GLSL rim light: brightness = specular *
    pow(edgeFactor, 3) * (0.25 + 0.75 * dot(outwardNormal, light)), light
    from the top-right. White-on-black; feBlend screen adds it. */
function buildSpecularMap(w: number, h: number, radius: number, bezel: number, specular: number): string {
  const key = `s${Math.round(w)}x${Math.round(h)}r${radius}b${bezel}s${Math.round(specular * 100)}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = MAP;
  canvas.height = MAP;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(MAP, MAP);
  const data = img.data;
  for (let j = 0; j < MAP; j++) {
    for (let i = 0; i < MAP; i++) {
      const idx = j * MAP + i;
      const x = ((i + 0.5) / MAP) * w;
      const y = ((j + 0.5) / MAP) * h;
      const d = -roundedRectSdf(x, y, w, h, radius);
      const base = d <= 0 ? 1 : 0; // inside
      const depth = Math.min(Math.max(d, 0), bezel);
      const e = 1 - depth / bezel;
      const rim = Math.pow(e, 3);
      const nl = Math.hypot(x - w / 2, y - h / 2) || 1;
      const nx = (x - w / 2) / nl;
      const ny = (y - h / 2) / nl;
      const l = Math.max(nx * 0.6 + ny * -0.8, 0) / Math.hypot(0.6, 0.8);
      const v = base * specular * rim * (0.25 + 0.75 * l) * 0.6 * 255;
      data[idx * 4] = Math.round(v);
      data[idx * 4 + 1] = Math.round(v);
      data[idx * 4 + 2] = Math.round(v);
      data[idx * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (mapCache.size > 24) mapCache.clear();
  mapCache.set(key, url);
  return url;
}

/**
 * Method 4 — the WebGL shader pipeline translated 1:1 into one SVG filter:
 * magnifier displacement, three-pass chromatic aberration, and a
 * generated specular-rim map (fresnel light from the top-right) composited
 * in and screened over the refracted backdrop.
 */
function GlassSvgShader({ params, width, height }: { params: Record<string, number>; width: number; height: number }) {
  const theme = useTheme();
  const id = `svgshader-${useId().replace(/:/g, "")}`;
  const dispMap = useMemo(
    () => buildDisplacementMap(width, height, params.radius, params.bezel, params.maxDisp),
    [width, height, params.radius, params.bezel, params.maxDisp],
  );
  const specMap = useMemo(
    () => buildSpecularMap(width, height, params.radius, params.bezel, params.specular),
    [width, height, params.radius, params.bezel, params.specular],
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
            <feImage href={dispMap} x={0} y={0} width={Math.round(width)} height={Math.round(height)} preserveAspectRatio="none" result="map" />
            {/* Render-order fix: the tint layer is translucent, so
                SourceGraphic arrives quarter-alpha and every screen blend
                below stacks dark murk. Normalize alpha to 1 FIRST - the
                rest of the pipeline then works on an opaque image, exactly
                like the WebGL texture. */}
            <feComponentTransfer in="SourceGraphic" result="opaque">
              <feFuncA type="linear" slope={1 / Math.max(params.tint, 0.05)} intercept={0} />
            </feComponentTransfer>
            {/* Chromatic aberration: three stepped displacement passes. */}
            <feDisplacementMap in="opaque" in2="map" scale={s} xChannelSelector="R" yChannelSelector="G" result="dR" />
            <feDisplacementMap in="opaque" in2="map" scale={Math.max(0, s - ab * 0.5)} xChannelSelector="R" yChannelSelector="G" result="dG" />
            <feDisplacementMap in="opaque" in2="map" scale={Math.max(0, s - ab)} xChannelSelector="R" yChannelSelector="G" result="dB" />
            <feColorMatrix in="dR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cR" />
            <feColorMatrix in="dG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cG" />
            <feColorMatrix in="dB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cB" />
            <feBlend in="cR" in2="cG" mode="screen" result="rg" />
            <feBlend in="rg" in2="cB" mode="screen" result="refracted" />
            {/* Specular rim: the generated map, clipped to the glass and screened. */}
            <feImage href={specMap} x={0} y={0} width={Math.round(width)} height={Math.round(height)} preserveAspectRatio="none" result="spec" />
            <feComposite in="spec" in2="refracted" operator="in" result="specIn" />
            <feBlend in="specIn" in2="refracted" mode="screen" />
          </filter>
        </defs>
      </svg>
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          bgcolor: alpha(theme.palette.mode === "dark" ? "#181226" : "#ffffff", params.tint),
          backdropFilter: `blur(${params.blur}px) saturate(${params.saturate})`,
          filter: `url(#${id}) contrast(1.15) brightness(1.05)`,
        }}
      />
    </Box>
  );
}

export const glassSvgShaderDef: ExperimentDef = {
  id: "glass-svg-shader",
  label: "Glass — SVG shader copy",
  defaultSize: { w: 220, h: 150 },
  params: [
    { key: "radius", label: "Corner radius", min: 8, max: 60, step: 1, default: 24 },
    { key: "maxDisp", label: "Refraction, px", min: 0, max: 40, step: 1, default: 16 },
    { key: "bezel", label: "Lens band, px", min: 6, max: 40, step: 1, default: 24 },
    { key: "aberration", label: "Aberration, px", min: 0, max: 6, step: 0.5, default: 2 },
    { key: "specular", label: "Specular", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "blur", label: "Blur, px", min: 0, max: 10, step: 0.5, default: 1 },
    { key: "saturate", label: "Saturate", min: 1, max: 2, step: 0.05, default: 1.4 },
    { key: "tint", label: "Tint opacity", min: 0, max: 0.6, step: 0.05, default: 0.25 },
  ],
  Component: GlassSvgShader,
};
