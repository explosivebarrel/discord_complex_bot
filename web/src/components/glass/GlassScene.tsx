import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAppTheme } from "../../themes/AppThemeContext";
import type { GlassBackdrop } from "../../themes/AppThemeContext";
import { BACKDROP_GLSL } from "./backdropGlsl";
import { glassIslandEntries, glassSeek } from "./glassRegistry";

const MAX_ISLANDS = 14;

const VERT_ES3 = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const VERT_ES1 = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Shader body shared by the ES3 (WebGL2) and ES1 (WebGL1) variants; the
// wrappers below only differ in version header and loop bounds. ES3 is the
// real target: its dynamic loops compile into a small D3D program, while
// the ES1 unrolled equivalent used to stall drivers for seconds.
const BODY = `
uniform vec2 u_res;      // viewport size in CSS px
uniform float u_time;
uniform float u_aberration;
uniform float u_specular;
uniform vec4 u_islands[${MAX_ISLANDS}];   // rect: x, y, w, h (CSS px)
uniform vec4 u_iglass[${MAX_ISLANDS}];    // radius, tint rgb
uniform vec4 u_iglass2[${MAX_ISLANDS}];   // tintAlpha, bezel, maxDisp, kind

${BACKDROP_GLSL}

{{PROTO}}
// The "draw everything first" layer: the raw backdrop with every frosted
// panel composited over it (rounded, tinted interior, ambient shadow,
// faint edge definition — no rim refraction). Lenses sample this, so a
// dock inside the content column refracts the panel it sits on, not the
// raw backdrop behind it. One backdrop evaluation per panel on purpose:
// call sites of this function are inlined by the compiler, and multi-tap
// blurs here explode the HLSL into minute-long driver compiles.
vec3 sceneColor(vec2 px, float t) {
  vec3 col = backdropColor(px, t);
  for (int i = 0; i < {{COUNT}}; i++) {
    vec4 rc = u_islands[i];
    if (rc.z < 1.0 || u_iglass2[i].w != 0.0) continue;
    float radius = min(u_iglass[i].x, min(rc.z, rc.w) * 0.5);
    vec2 half_ = rc.zw * 0.5 - 1.0;
    vec2 local = px - rc.xy - rc.zw * 0.5;
    float d = sdRoundBox(local, half_, radius);
    float inside = 1.0 - smoothstep(-1.0, 1.0, d);
    if (inside <= 0.001) {
      col *= 1.0 - exp(-max(d, 0.0) / 30.0) * 0.45;
      continue;
    }
    vec3 glass = mix(backdropColor(px, t), u_iglass[i].yzw, u_iglass2[i].x);
    float e = 1.0 - clamp(-d / 24.0, 0.0, 1.0);
    float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
    glass += u_specular * 0.35 * e * e * (0.25 + 0.75 * l);
    col = mix(col, glass, inside);
  }
  return col;
}

// The sandbox lens, ported 1:1: smoothstep-eased rim over the bezel band,
// radial refraction peaking at maxDisp on the edge, per-channel chromatic
// pull, a rim-weighted lift and a fresnel specular rim. The chromatic
// channels reuse the cheap raw backdrop — a full scene sample per channel
// would multiply the shader the driver has to compile. The body takes the
// green sample as an argument so the two nesting levels differ only in
// what they sample (GLSL forbids recursion, so lens-in-lens compositing
// is one level deep by construction).
vec3 lensBody(int i, vec2 px, float t, float gSample, float e, vec2 refr, vec2 dir, vec2 local, vec2 half_) {
  float ab = u_aberration * e;
  vec3 glass;
  glass.g = gSample;
  glass.r = backdropColor(refr + dir * ab, t).r;
  glass.b = backdropColor(refr - dir * ab, t).b;
  glass = glass * mix(0.96, 1.0, e) + vec3(0.06, 0.05, 0.10) * e;
  glass = mix(glass, u_iglass[i].yzw, u_iglass2[i].x);
  float rim = pow(e, 3.0);
  float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
  glass += u_specular * rim * (0.25 + 0.75 * l) * 0.6;
  return glass;
}

// The player seek line, drawn into the dock's glass so the FAB lens
// refracts it too (DOM cannot be read by the shader). u_seek.xywh is the
// 4px bar in CSS px, w<=0 disables it; u_seekAfter is the lens index the
// bar belongs to (drawn right after that lens composite).
uniform vec4 u_seek;
uniform float u_seekFrac;
uniform float u_seekThumb;
uniform float u_seekAfter;
uniform vec3 u_seekBg;
uniform vec3 u_seekFill;

vec3 drawSeek(vec3 col, vec2 px) {
  if (u_seek.z < 4.0) return col;
  vec2 half_ = vec2(u_seek.z * 0.5 - 1.0, 1.0);
  vec2 local = px - u_seek.xy - u_seek.zw * 0.5;
  float d = sdRoundBox(local, half_, 2.0);
  float inbar = 1.0 - smoothstep(-0.7, 0.7, d);
  float fillEdge = u_seek.x + u_seek.z * u_seekFrac;
  float past = smoothstep(fillEdge - 0.6, fillEdge + 0.6, px.x);
  vec3 bar = mix(u_seekFill, u_seekBg, past);
  float dt = length(px - vec2(u_seek.x + u_seek.z * u_seekFrac, u_seek.y + 2.0));
  float thumb = u_seekThumb * (1.0 - smoothstep(5.0, 6.5, dt));
  bar = mix(bar, u_seekFill * 1.2 + vec3(0.06), thumb);
  return mix(col, bar, inbar);
}

// Bottom lens level: refracts the panel layer.
vec3 lensGlassBase(int i, vec2 px, float t) {
  vec4 rc = u_islands[i];
  float radius = min(u_iglass[i].x, min(rc.z, rc.w) * 0.5);
  vec2 half_ = rc.zw * 0.5 - 1.5;
  vec2 local = px - rc.xy - rc.zw * 0.5;
  float bezel = max(u_iglass2[i].y, 6.0);
  float d = sdRoundBox(local, half_, radius);
  float depth = clamp(-d, 0.0, bezel);
  float e = 1.0 - depth / bezel;
  e = e * e * (3.0 - 2.0 * e);
  vec2 dir = normalize(local + vec2(0.0001, 0.0001));
  vec2 refr = px - dir * e * u_iglass2[i].z;
  return lensBody(i, px, t, sceneColor(refr, t).g, e, refr, dir, local, half_);
}
`;

// WebGL2: dynamic loops and a scene that can include the lenses below a
// given index, so overlapping lenses (the FAB over the dock) refract what
// the lenses beneath them painted — z-order within the canvas.
const FRAG_ES3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 fragColor;
uniform int u_count;
${BODY.split("{{COUNT}}").join("u_count").split("{{PROTO}}").join("vec3 sceneUpTo(vec2 px, float t, int top);")}
vec3 sceneUpTo(vec2 px, float t, int top) {
  vec3 col = sceneColor(px, t);
  for (int i = 0; i < u_count; i++) {
    if (i >= top) break;
    vec4 rc = u_islands[i];
    if (rc.z < 1.0 || u_iglass2[i].w != 1.0) continue;
    float radius = min(u_iglass[i].x, min(rc.z, rc.w) * 0.5);
    vec2 half_ = rc.zw * 0.5 - 1.5;
    vec2 local = px - rc.xy - rc.zw * 0.5;
    float d = sdRoundBox(local, half_, radius);
    float inside = 1.0 - smoothstep(-0.5, 0.5, d);
    if (inside <= 0.001) {
      col *= 1.0 - exp(-max(d, 0.0) / 30.0) * 0.45;
      continue;
    }
    col = mix(col, lensGlassBase(i, px, t), inside);
    if (float(i) == u_seekAfter) col = drawSeek(col, px);
  }
  return col;
}

void main() {
  // v_uv is y-up (GL); the DOM and getBoundingClientRect are y-down.
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  float t = u_time;
  vec3 col = sceneColor(px, t);
  for (int i = 0; i < u_count; i++) {
    vec4 rc = u_islands[i];
    if (rc.z < 1.0 || u_iglass2[i].w != 1.0) continue;
    float radius = min(u_iglass[i].x, min(rc.z, rc.w) * 0.5);
    vec2 half_ = rc.zw * 0.5 - 1.5;
    vec2 local = px - rc.xy - rc.zw * 0.5;
    float d = sdRoundBox(local, half_, radius);
    float inside = 1.0 - smoothstep(-0.5, 0.5, d);
    if (inside <= 0.001) {
      col *= 1.0 - exp(-max(d, 0.0) / 30.0) * 0.45;
      continue;
    }
    float bezel = max(u_iglass2[i].y, 6.0);
    float depth = clamp(-d, 0.0, bezel);
    float e = 1.0 - depth / bezel;
    e = e * e * (3.0 - 2.0 * e);
    vec2 dir = normalize(local + vec2(0.0001, 0.0001));
    vec2 refr = px - dir * e * u_iglass2[i].z;
    vec3 glass = lensBody(i, px, t, sceneUpTo(refr, t, i).g, e, refr, dir, local, half_);
    col = mix(col, glass, inside);
    if (float(i) == u_seekAfter) col = drawSeek(col, px);
  }
  fragColor = vec4(col, 1.0);
}`;

// WebGL1 fallback: fixed loop bounds, single-level lenses (no lens-over-
// lens; only ancient browsers take this path).
const FRAG_ES1 = `
precision highp float;
varying vec2 v_uv;
${BODY.split("{{COUNT}}").join(String(MAX_ISLANDS)).split("{{PROTO}}").join("")}
void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  float t = u_time;
  vec3 col = sceneColor(px, t);
  for (int i = 0; i < 14; i++) {
    vec4 rc = u_islands[i];
    if (rc.z < 1.0 || u_iglass2[i].w != 1.0) continue;
    float radius = min(u_iglass[i].x, min(rc.z, rc.w) * 0.5);
    vec2 half_ = rc.zw * 0.5 - 1.5;
    vec2 local = px - rc.xy - rc.zw * 0.5;
    float d = sdRoundBox(local, half_, radius);
    float inside = 1.0 - smoothstep(-0.5, 0.5, d);
    if (inside <= 0.001) {
      col *= 1.0 - exp(-max(d, 0.0) / 30.0) * 0.45;
      continue;
    }
    vec3 glass = lensGlassBase(i, px, t);
    col = mix(col, glass, inside);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** One-time WebGL availability probe (a scratch canvas, cheap). */
let webglProbe: boolean | null = null;
export function webglSupported(): boolean {
  if (webglProbe === null) {
    try {
      const c = document.createElement("canvas");
      webglProbe = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webglProbe = false;
    }
  }
  return webglProbe;
}

const MODE: Record<GlassBackdrop, number> = {
  mesh: 0,
  "stars-sparse": 1,
  "stars-medium": 2,
  "stars-dense": 3,
  stripes: 4,
  grid: 5,
};

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("glass scene shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

// Per-frame uniform scratch buffers (reused; one scene instance exists).
const rectsScratch = new Float32Array(MAX_ISLANDS * 4);
const glassAScratch = new Float32Array(MAX_ISLANDS * 4);
const glassBScratch = new Float32Array(MAX_ISLANDS * 4);

/** Per-scene GL state, filled in by the async warm-up below. */
interface SceneGl {
  gl: WebGLRenderingContext;
  uTime: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uMode: WebGLUniformLocation | null;
  uBlobs: WebGLUniformLocation | null;
  uCount: WebGLUniformLocation | null;
  uIslands: WebGLUniformLocation | null;
  uIglass: WebGLUniformLocation | null;
  uIglass2: WebGLUniformLocation | null;
  uAberration: WebGLUniformLocation | null;
  uSpecular: WebGLUniformLocation | null;
  uSeek: WebGLUniformLocation | null;
  uSeekFrac: WebGLUniformLocation | null;
  uSeekThumb: WebGLUniformLocation | null;
  uSeekAfter: WebGLUniformLocation | null;
  uSeekBg: WebGLUniformLocation | null;
  uSeekFill: WebGLUniformLocation | null;
  animate: boolean;
  dpr: () => number;
  resize: () => void;
}
const blobsScratch = new Float32Array(15);
const seekBgScratch = new Float32Array(3);
const seekFillScratch = new Float32Array(3);

/**
 * The single WebGL scene behind the Liquid Glass theme: the procedural
 * backdrop, the frosted layout panels and every refracting surface (dock,
 * FAB, buttons) live in one fragment shader — the lens evaluates the
 * composited scene at the refracted position, so the refraction is
 * float-exact with no textures and no CPU copies. One context, one rAF
 * loop, one draw call for the whole app.
 */
export function GlassScene() {
  const { glassBackdrop, glassTuning, scheme } = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Warm-up progress pill: shader compilation and the first draw happen on
  // the driver and can stall the tab for a few seconds; the pill (painted
  // before the blocking work, spinner on a compositor transform animation)
  // makes that visible instead of a frozen screen.
  const [warmStage, setWarmStage] = useState<string | null>(null);
  const [warmVisible, setWarmVisible] = useState(false);
  // Live settings: the scene mounts once and reads these per frame, so
  // dragging the tuning sliders never recompiles the shaders.
  const tuningRef = useRef(glassTuning);
  tuningRef.current = glassTuning;
  const backdropRef = useRef(glassBackdrop);
  backdropRef.current = glassBackdrop;
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl2 = canvas.getContext("webgl2", { alpha: false, antialias: false });
    const es3 = !!gl2;
    const gl = (gl2 ?? canvas.getContext("webgl", { alpha: false, antialias: false })) as WebGLRenderingContext | null;
    if (!gl) return;
    const t0 = performance.now();
    let cancelled = false;
    const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => { requestAnimationFrame(() => r()); }));
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let firstFrameCb: (() => void) | null = null;
    const firstFrame = new Promise<void>((r) => { firstFrameCb = r; });
    let firstFrameDone = false;
    let raf = 0;
    let running = true;
    let scene: SceneGl | null = null;
    setWarmVisible(true);

    const frame = (now: number) => {
      if (!running || !scene) return;
      const { gl, uTime, uRes, uMode, uBlobs, uCount, uIslands, uIglass, uIglass2, uAberration, uSpecular, uSeek, uSeekFrac, uSeekThumb, uSeekAfter, uSeekBg, uSeekFill, animate } = scene;
      const tuning = tuningRef.current;
      const tokens = schemeRef.current.tokens;
      gl.uniform1f(uTime, animate ? (now - t0) / 1000 : 1.0);
      gl.uniform1f(uMode, MODE[backdropRef.current]);
      blobsScratch.set([
        tokens.primaryContainer, tokens.tertiaryContainer, tokens.secondaryContainer,
        tokens.primary, tokens.tertiary,
      ].flatMap(hexRgb));
      gl.uniform3fv(uBlobs, blobsScratch);
      gl.uniform1f(uAberration, tuning.aberration);
      gl.uniform1f(uSpecular, tuning.specular);
      const entries = glassIslandEntries();
      // The seek line drawn into the dock's glass (index of the wide lens).
      let seekAfter = -1;
      for (let i = 0; i < entries.length && i < MAX_ISLANDS; i++) {
        if (entries[i].kind === "lens" && entries[i].el.getBoundingClientRect().width > 300) {
          seekAfter = i;
          break;
        }
      }
      gl.uniform4f(uSeek, glassSeek.x, glassSeek.y, glassSeek.w, glassSeek.h);
      gl.uniform1f(uSeekFrac, glassSeek.frac);
      gl.uniform1f(uSeekThumb, glassSeek.thumb);
      gl.uniform1f(uSeekAfter, seekAfter);
      seekBgScratch.set(hexRgb(tokens.surfaceContainerHighest));
      seekFillScratch.set(hexRgb(tokens.primary));
      gl.uniform3fv(uSeekBg, seekBgScratch);
      gl.uniform3fv(uSeekFill, seekFillScratch);
      const rects = rectsScratch;
      const glassA = glassAScratch;
      const glassB = glassBScratch;
      const panelTint = hexRgb(tuning.panelTint);
      const lensTint = hexRgb(tuning.lensTint);
      let n = 0;
      for (const { el, radius, kind } of entries) {
        if (n >= MAX_ISLANDS) break;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        rects.set([r.left, r.top, r.width, r.height], n * 4);
        const [tr, tg, tb] = kind === "panel" ? panelTint : lensTint;
        glassA.set([radius, tr, tg, tb], n * 4);
        glassB.set(
          [kind === "panel" ? tuning.panelTintAlpha : tuning.lensTintAlpha, tuning.bezel, tuning.maxDisp, kind === "panel" ? 0 : 1],
          n * 4,
        );
        n++;
      }
      // Zero out unused slots so the shader skips them.
      rects.fill(0, n * 4);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * scene.dpr()) || canvas.height !== Math.round(h * scene.dpr())) {
        scene.resize();
        gl.uniform2f(uRes, w, h);
      }
      if (uCount) gl.uniform1i(uCount, n);
      gl.uniform4fv(uIslands, rects);
      gl.uniform4fv(uIglass, glassA);
      gl.uniform4fv(uIglass2, glassB);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!firstFrameDone) {
        firstFrameDone = true;
        firstFrameCb?.();
      }
      raf = requestAnimationFrame(frame);
    };

    (async () => {
      setWarmStage("Compiling shaders…");
      await nextPaint();
      if (cancelled) return;
      const vs = compile(gl, gl.VERTEX_SHADER, es3 ? VERT_ES3 : VERT_ES1);
      const fs = compile(gl, gl.FRAGMENT_SHADER, es3 ? FRAG_ES3 : FRAG_ES1);
      if (!vs || !fs) { setWarmStage(null); return; }
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn("glass scene program:", gl.getProgramInfoLog(prog));
        setWarmStage(null);
        return;
      }
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const resize = () => {
        const dpr = Math.min((window.devicePixelRatio || 1) * tuningRef.current.renderScale, 3);
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        // u_res has no default: without this the first frames render the
        // whole screen from one pixel until the first window resize.
        gl.uniform2f(gl.getUniformLocation(prog, "u_res"), window.innerWidth, window.innerHeight);
      };
      resize();

      scene = {
        gl,
        uTime: gl.getUniformLocation(prog, "u_time"),
        uRes: gl.getUniformLocation(prog, "u_res"),
        uMode: gl.getUniformLocation(prog, "u_mode"),
        uBlobs: gl.getUniformLocation(prog, "u_blobs"),
        uCount: gl.getUniformLocation(prog, "u_count"),
        uIslands: gl.getUniformLocation(prog, "u_islands"),
        uIglass: gl.getUniformLocation(prog, "u_iglass"),
        uIglass2: gl.getUniformLocation(prog, "u_iglass2"),
        uAberration: gl.getUniformLocation(prog, "u_aberration"),
        uSpecular: gl.getUniformLocation(prog, "u_specular"),
        uSeek: gl.getUniformLocation(prog, "u_seek"),
        uSeekFrac: gl.getUniformLocation(prog, "u_seekFrac"),
        uSeekThumb: gl.getUniformLocation(prog, "u_seekThumb"),
        uSeekAfter: gl.getUniformLocation(prog, "u_seekAfter"),
        uSeekBg: gl.getUniformLocation(prog, "u_seekBg"),
        uSeekFill: gl.getUniformLocation(prog, "u_seekFill"),
        // Reduced motion freezes the animation clock; layout still redraws.
        animate: !reduced,
        dpr: () => Math.min((window.devicePixelRatio || 1) * tuningRef.current.renderScale, 3),
        resize,
      };

      setWarmStage("Warming up the GPU…");
      await nextPaint();
      if (cancelled) return;
      raf = requestAnimationFrame(frame);
      await firstFrame;
      if (cancelled) return;
      // A fast machine never shows the pill; a slow warm-up stays readable.
      if (performance.now() - t0 > 400) {
        setWarmStage("Glass ready");
        await sleep(900);
      }
      if (!cancelled) setWarmStage(null);
    })();

    const onResize = () => {
      if (scene) {
        gl.uniform2f(scene.uRes, window.innerWidth, window.innerHeight);
        scene.resize();
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // The scene mounts once; settings and theme changes are read live
    // through the refs above, so the shaders never recompile mid-session.
  }, []);

  return (
    <>
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
          pointerEvents: "none",
        }}
      />
      {warmStage && warmVisible && (
        <Box
          sx={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            px: 2,
            py: 1.25,
            borderRadius: "999px",
            bgcolor: alpha(schemeRef.current.tokens.surfaceContainerHigh, 0.8),
            backdropFilter: "blur(10px)",
            border: "1px solid",
            borderColor: alpha(schemeRef.current.tokens.outlineVariant, 0.5),
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
            pointerEvents: "none",
          }}
        >
          <Box
            sx={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: "2px solid",
              borderColor: alpha(schemeRef.current.tokens.primary, 0.25),
              borderTopColor: schemeRef.current.tokens.primary,
              animation: "glass-warm-spin 0.8s linear infinite",
              "@keyframes glass-warm-spin": { to: { transform: "rotate(360deg)" } },
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: schemeRef.current.tokens.onSurface, whiteSpace: "nowrap" }}
          >
            {warmStage}
          </Typography>
        </Box>
      )}
    </>
  );
}
