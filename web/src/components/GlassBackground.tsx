import { useEffect, useRef, useSyncExternalStore } from "react";
import { Box } from "@mui/material";
import { useAppTheme } from "../themes/AppThemeContext";

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  amp: number;
  phase: number;
  speed: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  dur: number;
}

const METEOR_MIN_GAP = 8000;
const METEOR_VAR = 8000;
const STAR_DENSITY: Record<string, number> = { "stars-sparse": 1, "stars-medium": 2.4, "stars-dense": 5 };

/** Live handle to the glass backdrop canvas — WebGL glass samples it.
    `scale` is the devicePixelRatio the canvas was rasterized with, so
    consumers can map CSS pixels onto the texture. */
const holder: { canvas: HTMLCanvasElement | null; scale: number } = { canvas: null, scale: 1 };
export const glassCanvasHolder = holder;
const holderListeners = new Set<() => void>();

function setHolderCanvas(canvas: HTMLCanvasElement | null) {
  if (holder.canvas === canvas) return;
  holder.canvas = canvas;
  holderListeners.forEach((l) => l());
}

/** Reactive read of the backdrop canvas: re-renders when the canvas mounts
    (theme switch, backdrop change), so glass panels rendered before it
    latch on instead of waiting for an unrelated re-render. */
export function useGlassCanvas() {
  return useSyncExternalStore(
    (cb) => {
      holderListeners.add(cb);
      return () => holderListeners.delete(cb);
    },
    () => holder.canvas,
  );
}

function drawStaticBackdrop(ctx: CanvasRenderingContext2D, kind: string, w: number, h: number) {
  if (kind === "stripes") {
    ctx.fillStyle = "#0b0b10";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#eceaf0";
    for (let x = 0; x < w; x += 180) ctx.fillRect(x, 0, 90, h);
  } else {
    // Checkerboard.
    const cell = 44;
    for (let y = 0; y < Math.ceil(h / cell); y++) {
      for (let x = 0; x < Math.ceil(w / cell); x++) {
        ctx.fillStyle = (x + y) % 2 ? "#d6d2de" : "#16121f";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
}

/**
 * Fixed backdrop of the Liquid Glass theme, always rendered into one
 * canvas so WebGL glass surfaces can sample it as a texture: twinkling
 * stars with occasional meteors, or dense star fields / wide vertical
 * stripes / a checkerboard (selected in the theme settings). A lilac-white
 * neon light rakes from the left to backlight the glass. The rAF loop
 * pauses with the tab; the system "reduce motion" setting renders a
 * single still frame.
 */
export function GlassBackground() {
  const { glassBackdrop } = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stars = glassBackdrop in STAR_DENSITY;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setHolderCanvas(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const density = STAR_DENSITY[glassBackdrop] ?? 1;
    let starsArr: Star[] = [];
    let meteor: Meteor | null = null;
    let nextMeteorAt = performance.now() + 4000;
    let raf = 0;
    let running = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      holder.scale = dpr;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(Math.round((window.innerWidth * window.innerHeight * density) / 9000), 320 * density);
      starsArr = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 0.4 + Math.random() * 1.3,
        base: 0.22 + Math.random() * 0.45,
        amp: 0.12 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.4,
      }));
    };

    const draw = (t: number) => {
      if (stars) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        ctx.fillStyle = "#0d0a18";
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        for (const s of starsArr) {
          const a = reduced
            ? s.base + s.amp * 0.5
            : Math.max(0.05, Math.min(1, s.base + s.amp * Math.sin(s.phase + (t / 1000) * s.speed)));
          ctx.globalAlpha = a;
          ctx.fillStyle = "#E8E3FF";
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (meteor) {
          const p = (t - meteor.born) / meteor.dur;
          if (p >= 1) {
            meteor = null;
          } else {
            const hx = meteor.x + meteor.vx * p;
            const hy = meteor.y + meteor.vy * p;
            const tailX = hx - meteor.vx * 0.18;
            const tailY = hy - meteor.vy * 0.18;
            const grad = ctx.createLinearGradient(tailX, tailY, hx, hy);
            grad.addColorStop(0, "rgba(232,227,255,0)");
            grad.addColorStop(1, `rgba(232,227,255,${0.9 * (1 - p)})`);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(tailX, tailY);
            ctx.lineTo(hx, hy);
            ctx.stroke();
            ctx.globalAlpha = 0.9 * (1 - p);
            ctx.fillStyle = "#E8E3FF";
            ctx.beginPath();
            ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      } else {
        drawStaticBackdrop(ctx, glassBackdrop, window.innerWidth, window.innerHeight);
      }
    };

    const tick = (t: number) => {
      if (!running) return;
      if (stars && !meteor && t >= nextMeteorAt) {
        meteor = {
          x: Math.random() * window.innerWidth * 0.7,
          y: Math.random() * window.innerHeight * 0.3,
          vx: 260 + Math.random() * 160,
          vy: 120 + Math.random() * 90,
          born: t,
          dur: 900 + Math.random() * 500,
        };
        nextMeteorAt = t + METEOR_MIN_GAP + Math.random() * METEOR_VAR;
      }
      draw(t);
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    resize();
    // Static backdrops only need one frame.
    if (!stars || reduced) {
      draw(performance.now());
    } else {
      raf = requestAnimationFrame(tick);
    }
    const onResize = () => {
      resize();
      draw(performance.now());
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      setHolderCanvas(null);
    };
  }, [stars, glassBackdrop]);

  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        bgcolor: "background.default",
        pointerEvents: "none",
      }}
    >
      {/* The neon light source raking across the glass from the left. */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(95vw 130vh at -18% 42%, rgba(214,196,255,0.30), rgba(150,120,255,0.12) 42%, transparent 68%)",
        }}
      />
      <Box component="canvas" ref={canvasRef} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </Box>
  );
}
