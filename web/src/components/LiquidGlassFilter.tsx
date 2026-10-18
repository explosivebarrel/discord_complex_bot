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

const MAP_SIZE = 512;
const mapCache = new Map<string, { url: string; scale: number }>();

/**
 * Displacement map over a W×H element, rasterized at MAP_SIZE and encoded
 * for feDisplacementMap (R = X shift, G = Y shift, 128 = neutral).
 * Rim-only lens: within a band of constant `bezel` px the sample is
 * pulled toward the element center by at most `maxDisp` px (peak at the
 * very edge, easing to zero at the band's inner boundary). The magnitude
 * is BOUNDED - unlike a center-distance pinch, which scales with the
 * element size and shifts long edges by hundreds of px (banding steps of
 * scale/127 become visible as terracing). With maxDisp ~14 the 8-bit
 * quantization step is ~0.11 px: invisible.
 */
function buildDisplacementMap(w: number, h: number, radius: number, bezel: number, maxDisp: number) {
  const key = `${Math.round(w)}x${Math.round(h)}r${Math.round(radius)}b${Math.round(bezel)}m${Math.round(maxDisp)}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: "", scale: 0 };
  const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
  const data = img.data;

  for (let j = 0; j < MAP_SIZE; j++) {
    for (let i = 0; i < MAP_SIZE; i++) {
      const idx = j * MAP_SIZE + i;
      // Map coordinates stretch over the real element box, so the rim band
      // keeps a constant px thickness on every side regardless of aspect.
      const x = ((i + 0.5) / MAP_SIZE) * w;
      const y = ((j + 0.5) / MAP_SIZE) * h;
      const d = -roundedRectSdf(x, y, w, h, radius); // px inside from the edge
      if (d <= 0 || d >= bezel) continue;
      // Direction toward the center; on a convex shape this matches the
      // surface normal direction of the lens rim.
      const cx = w / 2 - x;
      const cy = h / 2 - y;
      const len = Math.hypot(cx, cy) || 1;
      // Peak at the very edge, easing to zero at the band's inner boundary.
      const u = d / bezel;
      const mag = maxDisp * Math.pow(1 - u, 1.25);
      data[idx * 4] = Math.round(128 + (cx / len) * (mag / maxDisp) * 127);
      data[idx * 4 + 1] = Math.round(128 + (cy / len) * (mag / maxDisp) * 127);
      data[idx * 4 + 2] = 128;
      data[idx * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const entry = { url: canvas.toDataURL(), scale: maxDisp };
  if (mapCache.size > 24) mapCache.clear();
  mapCache.set(key, entry);
  return entry;
}

/**
 * SVG filter defs for one glass element: just the displacement. Reference
 * it from a warp span as `filter: url(#id) contrast(1.15) brightness(1.05)`
 * layered over a plain `backdrop-filter: blur(2px) saturate(1.5)` (the
 * liquid-glass-react structure — keeps the url() out of backdrop-filter,
 * dodging the Chromium backdrop+transform paint bug). The filter region is
 * oversized so rim sampling does not clip.
 */
export function LiquidGlassFilter({
  id,
  width,
  height,
  radius = 0,
  bezel = 20,
  maxDisp = 14,
}: {
  id: string;
  width: number;
  height: number;
  radius?: number;
  bezel?: number;
  maxDisp?: number;
}) {
  const { url, scale } = useMemo(
    () => buildDisplacementMap(width, height, radius, bezel, maxDisp),
    [width, height, radius, bezel, maxDisp],
  );
  if (!url) return null;
  return (
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
          <feImage href={url} x={0} y={0} width={Math.round(width)} height={Math.round(height)} preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
