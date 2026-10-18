import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { useAppTheme } from "../themes/AppThemeContext";
import type { AuroraConfig } from "../themes/palettes";

const SEGMENTS = 160; // outline resolution of one wobbly blob
const RING_STEPS = 72; // radial gradient resolution (torus bands)
const BANDS = 3; // color bands cycling through the ring

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Color of the torus ring at gradient position p (0..1) and time t: three
 * color bands cycling outward over time, a thin contrast separator at every
 * band boundary, and soft blends between neighboring bands.
 */
function bandColor(cfg: AuroraConfig, blob: AuroraConfig["blobs"][number], p: number, t: number): Rgb {
  const u = p * BANDS - t * blob.drift;
  const k = Math.floor(u);
  const f = u - k;
  const cA = hexRgb(blob.colors[((k % BANDS) + BANDS) % BANDS]);
  const cB = hexRgb(blob.colors[(((k + 1) % BANDS) + BANDS) % BANDS]);
  // Bands blend into each other over the last quarter of the cycle.
  let c = mix(cA, cB, smooth(0.72, 1, f));
  // Thin contrast separator ring right at the band boundary.
  const sep = hexRgb(cfg.separator);
  c = mix(sep, c, smooth(0.02, 0.12, f));
  return c;
}

/** One frame of the whole backdrop at time t (seconds). */
export function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number, cfg: AuroraConfig, t: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = cfg.glow ? "lighter" : "source-over";
  const unit = Math.min(w, h);
  const baseAlpha = cfg.glow ? 0.34 : 0.5;
  for (const blob of cfg.blobs) {
    const cx = blob.x * w;
    const cy = blob.y * h;
    const r = blob.r * unit;
    // Wobbly outline: the radius is modulated by a pair of drifting sine
    // harmonics, so the edge bulges and relaxes organically over time.
    ctx.beginPath();
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const wob =
        1 +
        blob.wobble *
          (0.6 * Math.sin(3 * a + t * 0.31 + blob.x * 9) + 0.4 * Math.sin(5 * a - t * 0.23 + blob.y * 7));
      const px = cx + Math.cos(a) * r * wob;
      const py = cy + Math.sin(a) * r * wob;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    // Torus gradient: transparent hole in the middle, cycling color rings,
    // and a faded rim that dissolves into the background without seams.
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.15);
    const hole = 0.28;
    for (let s = 0; s <= RING_STEPS; s++) {
      const p = hole + ((1 - hole) * s) / RING_STEPS;
      const alpha = baseAlpha * smooth(hole, hole + 0.07, p) * (1 - smooth(0.88, 1, p));
      const c = bandColor(cfg, blob, p, t);
      grad.addColorStop(p, `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${alpha.toFixed(3)})`);
    }
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Fixed backdrop of the aurora themes: wobbly torus blobs (transparent
 * center and rim) whose color bands circulate from the center outward.
 * Respects the system "reduce motion" setting by rendering a still frame.
 */
export function AuroraBackground() {
  const { scheme } = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cfg = scheme.aurora;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cfg) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const frame = (now: number) => {
      if (!running) return;
      drawAurora(ctx, window.innerWidth, window.innerHeight, cfg, (now - start) / 1000);
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) drawAurora(ctx, window.innerWidth, window.innerHeight, cfg, 0);
    else raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cfg]);

  if (!cfg) return null;
  return (
    <Box
      aria-hidden
      component="canvas"
      ref={canvasRef}
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        width: "100%",
        height: "100%",
        bgcolor: "background.default",
        pointerEvents: "none",
      }}
    />
  );
}
