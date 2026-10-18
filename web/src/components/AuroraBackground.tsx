import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { useAppTheme } from "../themes/AppThemeContext";
import type { AuroraConfig } from "../themes/palettes";

const SEGMENTS = 128; // outline resolution of one wobbly contour
const RING_STEPS = 96; // radial gradient resolution (torus bands)
const BANDS = 3; // color bands cycling through the ring
const RENDER_SCALE = 0.5; // blobs render at half resolution, then upscale

/**
 * Superposition of drifting sine harmonics, normalized to [-1, 1] — the
 * wobbly edge shape shared by every blob (with per-blob phase seeds and
 * time speed factors, so no two edges move alike).
 */
const HARMONICS = [
  { k: 2, a: 0.3, w: 0.19, p: 1.7 },
  { k: 3, a: 0.24, w: -0.16, p: 4.2 },
  { k: 5, a: 0.2, w: 0.27, p: 0.6 },
  { k: 7, a: 0.16, w: -0.22, p: 3.1 },
  { k: 11, a: 0.1, w: 0.12, p: 5.0 },
];
const HNORM = HARMONICS.reduce((s, h) => s + h.a, 0);

function wobbleAt(angle: number, t: number, seed: number, speed: number): number {
  let s = 0;
  for (const h of HARMONICS) s += h.a * Math.sin(h.k * angle + h.w * t * speed + h.p + seed);
  return s / HNORM;
}

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
 * Color of the torus ring at ring position p (0..1) and time t: three
 * color bands cycling outward over time, a thin contrast separator at
 * every band boundary, and soft blends between neighboring bands.
 */

/** Wobbly closed contour of radius base*(1 + amp*wobble(angle)). */
function contourPath(
  ctx: CanvasRenderingContext2D,
  base: number,
  amp: number,
  t: number,
  seed: number,
  speed: number,
) {
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    const r = base * (1 + amp * wobbleAt(a, t, seed, speed));
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  blurOk: boolean;
}

/** One frame of the whole backdrop at animation phase t (seconds). */
export function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number, cfg: AuroraConfig, t: number, scratch: Scratch) {
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  const unit = Math.min(w, h);
  const baseAlpha = cfg.glow ? 0.34 : 0.5;
  for (const blob of cfg.blobs) {
    const cx = blob.x * w;
    const cy = blob.y * h;
    const r = blob.r * unit;
    const rIn = r * 0.3;
    // The inner edge wobbles too — its own harmonic phases and a slightly
    // faster time scale, so hole and rim never move in sync.
    const ampOut = 0.14;
    const ampIn = 0.16;
    // Feather width scales with the blob; the buffer margins cover both
    // the wobble swing and the blur bleed.
    const blurPx = Math.round(Math.min(20, Math.max(10, r * 0.04)));
    const extent = r * (1 + ampOut) + blurPx + 6;
    const M = Math.max(4, Math.ceil(2 * extent * RENDER_SCALE));
    if (scratch.canvas.width !== M) {
      scratch.canvas.width = M;
      scratch.canvas.height = M;
    }
    const sx = scratch.ctx;
    sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.clearRect(0, 0, M, M);
    sx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, M / 2, M / 2);
    // Torus bands: radial gradient spanning the ring between the two base
    // radii, color bands cycling from the center outward with soft blends.
    const grad = sx.createRadialGradient(0, 0, rIn * 0.92, 0, 0, r);
    for (let s = 0; s <= RING_STEPS; s++) {
      const p = s / RING_STEPS;
      const u = p * BANDS - t * blob.drift;
      const k = Math.floor(u);
      const f = u - k;
      const cA = hexRgb(blob.colors[((k % BANDS) + BANDS) % BANDS]);
      const cB = hexRgb(blob.colors[(((k + 1) % BANDS) + BANDS) % BANDS]);
      const c = mix(cA, cB, smooth(0.72, 1, f));
      grad.addColorStop(p, `rgb(${c.r | 0},${c.g | 0},${c.b | 0})`);
    }
    sx.fillStyle = grad;
    sx.beginPath();
    // Annulus: outer contour, then the inner one ("evenodd" cuts the hole).
    contourPath(sx, r, ampOut, t, blob.x * 9, 1);
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const rr = rIn * (1 + ampIn * wobbleAt(a, t, blob.y * 7, 1.35));
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) sx.moveTo(x, y);
      else sx.lineTo(x, y);
    }
    sx.closePath();
    sx.fill("evenodd");

    // Soft edges: the half-resolution buffer is upscaled with a real blur,
    // so BOTH the inner and the outer rim dissolve into the background.
    ctx.save();
    ctx.globalAlpha = baseAlpha;
    ctx.globalCompositeOperation = cfg.glow ? "lighter" : "source-over";
    if (scratch.blurOk) ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(scratch.canvas, cx - extent, cy - extent, extent * 2, extent * 2);
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

/**
 * Fixed backdrop of the aurora themes: wobbly torus blobs — the outer rim
 * AND the inner hole edge both ride a normalized superposition of sine
 * harmonics, color bands circulate from the center outward, and both edges
 * dissolve into the background through a real blur. Respects the system
 * "reduce motion" setting by rendering a still frame.
 */
export function AuroraBackground() {
  const { scheme } = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<Scratch | null>(null);
  const cfg = scheme.aurora;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cfg) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!scratchRef.current) {
      const sc = document.createElement("canvas");
      const sctx = sc.getContext("2d");
      if (!sctx) return;
      // canvas filter support: real blur on the upscaled blob (soft edges).
      sctx.filter = "blur(1px)";
      scratchRef.current = { canvas: sc, ctx: sctx, blurOk: sctx.filter === "blur(1px)" };
      sctx.filter = "none";
    }
    const scratch = scratchRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;
    let last = performance.now();
    let phase = 0;

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
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const frame = (now: number) => {
      if (!running) return;
      // The animation clock advances by clamped deltas: after a paused
      // (occluded) stretch the scene continues smoothly instead of jumping.
      phase += Math.min((now - last) / 1000, 0.1);
      last = now;
      drawAurora(ctx, window.innerWidth, window.innerHeight, cfg, phase, scratch);
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) drawAurora(ctx, window.innerWidth, window.innerHeight, cfg, 0, scratch);
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
