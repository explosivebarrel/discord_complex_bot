import { useEffect, useRef } from "react";
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

/**
 * Fixed backdrop of the Liquid Glass theme. The default starfield twinkles
 * with an occasional meteor; denser star fields, car-body-shop vertical
 * stripes and a checkerboard are selectable in the theme settings — all of
 * them give the lens something to refract. A lilac-white neon light rakes
 * from the left to backlight the glass. The rAF loop pauses with the tab;
 * the system "reduce motion" setting renders a single still frame.
 */
export function GlassBackground() {
  const { glassBackdrop } = useAppTheme();
  const stars = glassBackdrop in STAR_DENSITY;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!stars) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
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

    const drawStar = (s: Star, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#E8E3FF";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const s of starsArr) {
        const a = reduced
          ? s.base + s.amp * 0.5
          : Math.max(0.05, Math.min(1, s.base + s.amp * Math.sin(s.phase + (t / 1000) * s.speed)));
        drawStar(s, a);
      }
      if (meteor) {
        const p = (t - meteor.born) / meteor.dur;
        if (p >= 1) {
          meteor = null;
        } else {
          // Bright head with a fading trail along the flight direction.
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
    };

    const tick = (t: number) => {
      if (!running) return;
      if (!meteor && t >= nextMeteorAt) {
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
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) {
      draw(performance.now());
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
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
      {stars && (
        <Box component="canvas" ref={canvasRef} sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      )}
      {/* Refraction-test backdrops: car-body-shop stripes / checkerboard.
          Wide bars survive the glass blur and give the lens sharp edges. */}
      {glassBackdrop === "stripes" && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background: "repeating-linear-gradient(90deg, #0b0b10 0px, #0b0b10 90px, #eceaf0 90px, #eceaf0 180px)",
          }}
        />
      )}
      {glassBackdrop === "grid" && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            background: "repeating-conic-gradient(#141020 0% 25%, #241f36 0% 50%) 50% / 44px 44px",
          }}
        />
      )}
    </Box>
  );
}
