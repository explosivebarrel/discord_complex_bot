import { useMemo } from "react";

/**
 * Liquid Glass refraction (see kube.io "Liquid Glass in the Browser"):
 * an SVG displacement map bends the backdrop near the element's rim like
 * a lens with a clean center. Chromium is the only engine that renders
 * SVG filters inside backdrop-filter (Safari: no, Firefox: silently no),
 * so callers must gate on svgBackdropSupported().
 */

let svgBackdropOk: boolean | null = null;

/** JS gate for `backdrop-filter: url(#f)`: CSS.supports lies on Firefox. */
export function svgBackdropSupported(): boolean {
  if (svgBackdropOk === null) {
    const css = typeof CSS !== "undefined" && !!CSS.supports && CSS.supports("backdrop-filter", "url(#f)");
    const ff = typeof navigator !== "undefined" && /firefox|fxios/i.test(navigator.userAgent);
    svgBackdropOk = css && !ff;
  }
  return svgBackdropOk;
}

/** Signed distance to a rounded rectangle border (negative inside). */
function roundedRectSdf(x: number, y: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const MAP_SIZE = 256;
const mapCache = new Map<string, { url: string; scale: number }>();

/**
 * Displacement map over a W×H element, rasterized at MAP_SIZE and encoded
 * for feDisplacementMap (R = X shift, G = Y shift, 128 = neutral). The rim
 * of constant thickness `bezel` px bends light inward (Snell, n = 1.5)
 * over an Apple-style squircle surface profile; the center stays clean.
 */
function buildDisplacementMap(w: number, h: number, radius: number, bezel: number) {
  const key = `${Math.round(w)}x${Math.round(h)}r${Math.round(radius)}b${Math.round(bezel)}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: "", scale: 0 };
  const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
  const data = img.data;

  // Refraction offset by rim depth (0 at the outer edge, 1 at the inner
  // bezel boundary), from a single air->glass refraction of a vertical ray.
  const n = 1.5;
  const offsetAt = (t: number) => {
    // Squircle height profile of the lens wall.
    const height = Math.pow(1 - Math.pow(1 - t, 4), 0.25);
    const eps = 0.001;
    const slope = (Math.pow(1 - Math.pow(1 - (t + eps), 4), 0.25) - height) / eps;
    const sinIn = slope / Math.hypot(1, slope);
    return (sinIn - sinIn / n) * bezel;
  };

  let maxDisp = 0;
  const disp = new Float32Array(MAP_SIZE * MAP_SIZE);
  const nx = new Float32Array(MAP_SIZE * MAP_SIZE);
  const ny = new Float32Array(MAP_SIZE * MAP_SIZE);
  for (let j = 0; j < MAP_SIZE; j++) {
    for (let i = 0; i < MAP_SIZE; i++) {
      const idx = j * MAP_SIZE + i;
      // Map coordinates stretch over the real element box, so the rim has
      // a constant px thickness on every side regardless of aspect.
      const x = ((i + 0.5) / MAP_SIZE) * w;
      const y = ((j + 0.5) / MAP_SIZE) * h;
      const d = -roundedRectSdf(x, y, w, h, radius); // px inside from the edge
      if (d <= 0 || d >= bezel) continue;
      const e = 1;
      const gx = roundedRectSdf(x + e, y, w, h, radius) - roundedRectSdf(x - e, y, w, h, radius);
      const gy = roundedRectSdf(x, y + e, w, h, radius) - roundedRectSdf(x, y - e, w, h, radius);
      const len = Math.hypot(gx, gy) || 1;
      nx[idx] = gx / len; // outward normal
      ny[idx] = gy / len;
      const amount = offsetAt(Math.min(d / bezel, 1));
      disp[idx] = amount;
      if (amount > maxDisp) maxDisp = amount;
    }
  }
  if (maxDisp <= 0) maxDisp = 1;
  for (let idx = 0; idx < disp.length; idx++) {
    const k = (disp[idx] / maxDisp) * 127;
    data[idx * 4] = Math.round(128 + nx[idx] * k);
    data[idx * 4 + 1] = Math.round(128 + ny[idx] * k);
    data[idx * 4 + 2] = 128;
    data[idx * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const entry = { url: canvas.toDataURL(), scale: maxDisp };
  if (mapCache.size > 24) mapCache.clear();
  mapCache.set(key, entry);
  return entry;
}

/**
 * SVG filter defs for one glass element. Render it once near the element
 * and reference from CSS as `backdrop-filter: url(#${id}) ...`.
 */
export function LiquidGlassFilter({
  id,
  width,
  height,
  radius = 0,
  bezel = 40,
}: {
  id: string;
  width: number;
  height: number;
  radius?: number;
  bezel?: number;
}) {
  const { url, scale } = useMemo(
    () => buildDisplacementMap(width, height, radius, bezel),
    [width, height, radius, bezel],
  );
  if (!url) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <defs>
        <filter
          id={id}
          x={-20}
          y={-20}
          width={Math.round(width) + 40}
          height={Math.round(height) + 40}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feImage href={url} x={0} y={0} width={Math.round(width)} height={Math.round(height)} preserveAspectRatio="none" result="map" />
          {/* Displace the backdrop like a lens rim, then soften and enrich it. */}
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" result="refracted" />
          <feGaussianBlur in="refracted" stdDeviation="5" />
          <feColorMatrix type="saturate" values="1.5" />
        </filter>
      </defs>
    </svg>
  );
}
