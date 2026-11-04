import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAppTheme } from "../../themes/AppThemeContext";
import type { GlassBackdrop } from "../../themes/AppThemeContext";
import { BACKDROP_GLSL } from "./backdropGlsl";
import { glassIslandEntries } from "./glassRegistry";

const MAX_ISLANDS = 14;

/** Panel frost radius, CSS px (scaled to texels per frame). */
const PANEL_BLUR_PX = 10;

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

// WebGL2: dynamic loops and a scene that can include the lenses below a
// given index, so overlapping lenses (the FAB over the dock) refract what
// the lenses beneath them painted — z-order within the canvas.
// Pass A renders the procedural backdrop into a texture; pass B composites
// the panels, lenses and the seek line by sampling that texture. Keeping
// backdropColor out of the composite shader matters a lot: every call site
// is inlined by the shader compiler, and ~10 copies of the fbm/meteor code
// used to make ANGLE's HLSL take tens of seconds to compile.
const FRAG_BACKDROP_ES3 = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
${BACKDROP_GLSL}
void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  fragColor = vec4(backdropColor(px, u_time), 1.0);
}`;

const FRAG_BACKDROP_ES1 = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
${BACKDROP_GLSL}
void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  gl_FragColor = vec4(backdropColor(px, u_time), 1.0);
}`;

const FRAG_SCENE_ES3 = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_backdrop;
uniform vec2 u_res;
uniform float u_time;
uniform float u_aberration;
uniform float u_specular;
uniform vec4 u_islands[${MAX_ISLANDS}];
uniform vec4 u_iglass[${MAX_ISLANDS}];
uniform vec4 u_iglass2[${MAX_ISLANDS}];
vec3 sceneUpTo(vec2 px, float t, int top);

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}


// Frosted glass: one trilinear mip sample of the backdrop texture — a real
// continuous blur. Offset taps at this scale sample the already-blurred
// pyramid shifted, which reads as several overlapping copies of the image
// ("tripled"), so the pyramid alone does the filtering.
vec3 frost(vec2 px, float b) {
  return textureLod(u_backdrop, px / u_res, max(log2(b) - 1.0, 0.0)).rgb;
}

// Panels: frosted rounded slabs over the backdrop texture. The blur radius
// rides in u_iglass2[i].y (the bezel slot, unused for panels), pre-scaled
// to texture texels so renderScale does not change the look.
vec3 panelLayer(vec2 px, float t) {
  vec3 col = texture(u_backdrop, px / u_res).rgb;
  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
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
    vec3 glass = frost(px, max(u_iglass2[i].y, 2.0));
    glass = mix(glass, u_iglass[i].yzw, u_iglass2[i].x);
    float e = 1.0 - clamp(-d / 24.0, 0.0, 1.0);
    float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
    glass += u_specular * 0.35 * e * e * (0.25 + 0.75 * l);
    col = mix(col, glass, inside);
  }
  return col;
}

vec3 lensBody(int i, vec2 px, float t, float gSample, float e, vec2 refr, vec2 dir, vec2 local, vec2 half_) {
  float ab = u_aberration * e;
  vec3 glass;
  glass.g = gSample;
  glass.r = texture(u_backdrop, (refr + dir * ab) / u_res).r;
  glass.b = texture(u_backdrop, (refr - dir * ab) / u_res).b;
  glass = glass * mix(0.96, 1.0, e) + vec3(0.06, 0.05, 0.10) * e;
  glass = mix(glass, u_iglass[i].yzw, u_iglass2[i].x);
  float rim = pow(e, 3.0);
  float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
  glass += u_specular * rim * (0.25 + 0.75 * l) * 0.6;
  return glass;
}

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
  return lensBody(i, px, t, panelLayer(refr, t).g, e, refr, dir, local, half_);
}

// Panels + every lens below the given index, so overlapping lenses (the FAB over the
// dock) refract what the lenses beneath them painted.
vec3 sceneUpTo(vec2 px, float t, int top) {
  vec3 col = panelLayer(px, t);
  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
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
  }
  return col;
}

void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  float t = u_time;
  vec3 col = panelLayer(px, t);
  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
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
  }
  fragColor = vec4(col, 1.0);
}`;

const FRAG_SCENE_ES1 = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_backdrop;
uniform vec2 u_res;
uniform float u_time;
uniform float u_aberration;
uniform float u_specular;
uniform vec4 u_islands[${MAX_ISLANDS}];
uniform vec4 u_iglass[${MAX_ISLANDS}];
uniform vec4 u_iglass2[${MAX_ISLANDS}];
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}


vec3 panelLayer(vec2 px, float t) {
  vec3 col = texture2D(u_backdrop, px / u_res).rgb;
  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
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
    vec3 glass = col;
    // WebGL1 has no NPOT mipmaps: a 13-tap golden-angle disc stands in for
    // the frost (u_iglass2[i].y = blur radius in texels, same as WebGL2).
    vec3 acc = glass * 4.0;
    float wgt = 4.0;
    for (int k = 0; k < 12; k++) {
      float a = 2.399963 * float(k);
      float rr = sqrt((float(k) + 1.0) / 12.0) * u_iglass2[i].y * 0.7;
      acc += texture2D(u_backdrop, (px + vec2(cos(a), sin(a)) * rr) / u_res).rgb;
      wgt += 1.0;
    }
    glass = acc / wgt;
    glass = mix(glass, u_iglass[i].yzw, u_iglass2[i].x);
    float e = 1.0 - clamp(-d / 24.0, 0.0, 1.0);
    float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
    glass += u_specular * 0.35 * e * e * (0.25 + 0.75 * l);
    col = mix(col, glass, inside);
  }
  return col;
}
vec3 lensBody(int i, vec2 px, float t, float gSample, float e, vec2 refr, vec2 dir, vec2 local, vec2 half_) {
  float ab = u_aberration * e;
  vec3 glass;
  glass.g = gSample;
  glass.r = texture2D(u_backdrop, (refr + dir * ab) / u_res).r;
  glass.b = texture2D(u_backdrop, (refr - dir * ab) / u_res).b;
  glass = glass * mix(0.96, 1.0, e) + vec3(0.06, 0.05, 0.10) * e;
  glass = mix(glass, u_iglass[i].yzw, u_iglass2[i].x);
  float rim = pow(e, 3.0);
  float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
  glass += u_specular * rim * (0.25 + 0.75 * l) * 0.6;
  return glass;
}
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
  return lensBody(i, px, t, panelLayer(refr, t).g, e, refr, dir, local, half_);
}
void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  float t = u_time;
  vec3 col = panelLayer(px, t);
  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
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
    vec3 glass = lensBody(i, px, t, panelLayer(refr, t).g, e, refr, dir, local, half_);
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
const blobsScratch = new Float32Array(15);

/** Per-scene GL state, filled in by the async warm-up below. */
interface SceneGl {
  gl: WebGLRenderingContext;
  progA: WebGLProgram;
  progB: WebGLProgram;
  fbo: WebGLFramebuffer | null;
  backdropTex: WebGLTexture | null;
  timeA: WebGLUniformLocation | null;
  resA: WebGLUniformLocation | null;
  modeA: WebGLUniformLocation | null;
  blobsA: WebGLUniformLocation | null;
  timeB: WebGLUniformLocation | null;
  resB: WebGLUniformLocation | null;
  countB: WebGLUniformLocation | null;
  islandsB: WebGLUniformLocation | null;
  iglassB: WebGLUniformLocation | null;
  iglass2B: WebGLUniformLocation | null;
  aberrationB: WebGLUniformLocation | null;
  specularB: WebGLUniformLocation | null;
  backdropLocB: WebGLUniformLocation | null;
  animate: boolean;
  dpr: () => number;
  resize: () => void;
}

/**
 * The single WebGL scene behind the Liquid Glass theme, in two passes:
 * pass A renders the procedural backdrop into an offscreen texture, pass B
 * composites the frosted panels, the seek line and every refracting
 * surface (dock, FAB, buttons) by sampling that texture — the lens
 * refraction is float-exact and bilinearly filtered. One context, one
 * rAF loop, two small draw calls for the whole app. Splitting the passes
 * also keeps each shader small: ANGLE's compiler used to choke on the
 * single-program version where the procedural backdrop was inlined at
 * every lens sample site.
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

    const quad = (prog: WebGLProgram) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    };

    const frame = (now: number) => {
      if (!running || !scene) return;
      const tuning = tuningRef.current;
      const tokens = schemeRef.current.tokens;
      const t = scene.animate ? (now - t0) / 1000 : 1.0;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * scene.dpr()) || canvas.height !== Math.round(h * scene.dpr())) {
        scene.resize();
      }
      // Pass A: backdrop -> texture.
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(scene.progA);
      gl.uniform1f(scene.timeA, t);
      gl.uniform2f(scene.resA, w, h);
      gl.uniform1f(scene.modeA, MODE[backdropRef.current]);
      blobsScratch.set([
        tokens.primaryContainer, tokens.tertiaryContainer, tokens.secondaryContainer,
        tokens.primary, tokens.tertiary,
      ].flatMap(hexRgb));
      gl.uniform3fv(scene.blobsA, blobsScratch);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // WebGL2: regenerate the mip pyramid for the frost sampling below
      // (WebGL1 keeps LINEAR only — NPOT textures cannot be mipmapped).
      if (es3) gl.generateMipmap(gl.TEXTURE_2D);
      // Pass B: panels + lenses + seek over the backdrop texture.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(scene.progB);
      gl.uniform1f(scene.timeB, t);
      gl.uniform2f(scene.resB, w, h);
      gl.uniform1f(scene.aberrationB, tuning.aberration);
      gl.uniform1f(scene.specularB, tuning.specular);
      const entries = glassIslandEntries();
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
          [
            kind === "panel" ? tuning.panelTintAlpha : tuning.lensTintAlpha,
            // For panels the y slot is the frost radius (texels): CSS px
            // scaled by the render scale so the look is renderScale-invariant.
            kind === "panel" ? PANEL_BLUR_PX * scene.dpr() : tuning.bezel,
            tuning.maxDisp,
            kind === "panel" ? 0 : 1,
          ],
          n * 4,
        );
        n++;
      }
      rects.fill(0, n * 4);
      if (scene.countB) gl.uniform1i(scene.countB, n);
      gl.uniform4fv(scene.islandsB, rects);
      gl.uniform4fv(scene.iglassB, glassA);
      gl.uniform4fv(scene.iglass2B, glassB);
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
      const fragBackdrop = es3 ? FRAG_BACKDROP_ES3 : FRAG_BACKDROP_ES1;
      const fragScene = es3 ? FRAG_SCENE_ES3 : FRAG_SCENE_ES1;
      const vertSrc = es3 ? VERT_ES3 : VERT_ES1;
      const buildProgram = (fragSrc: string): WebGLProgram | null => {
        const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
        const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
        if (!vs || !fs) return null;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          console.warn("glass scene program:", gl.getProgramInfoLog(prog));
          return null;
        }
        return prog;
      };
      setWarmStage("Compiling shaders (1/2)…");
      await nextPaint();
      const progA = buildProgram(fragBackdrop);
      if (!progA) { setWarmStage(null); return; }
      setWarmStage("Compiling shaders (2/2)…");
      await nextPaint();
      const progB = buildProgram(fragScene);
      if (!progB) { setWarmStage(null); return; }
      gl.useProgram(progA);
      quad(progA);
      gl.useProgram(progB);
      quad(progB);

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const resize = () => {
        const dpr = Math.min((window.devicePixelRatio || 1) * tuningRef.current.renderScale, 3);
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.bindTexture(gl.TEXTURE_2D, backdropTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.uniform2f(resLocA, canvas.width, canvas.height);
        gl.uniform2f(resLocB, window.innerWidth, window.innerHeight);
      };

      const backdropTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, backdropTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, es3 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, backdropTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const resLocA = gl.getUniformLocation(progA, "u_res");
      const resLocB = gl.getUniformLocation(progB, "u_res");

      scene = {
        gl,
        progA,
        progB,
        fbo,
        backdropTex,
        timeA: gl.getUniformLocation(progA, "u_time"),
        resA: resLocA,
        modeA: gl.getUniformLocation(progA, "u_mode"),
        blobsA: gl.getUniformLocation(progA, "u_blobs"),
        timeB: gl.getUniformLocation(progB, "u_time"),
        resB: resLocB,
        countB: gl.getUniformLocation(progB, "u_count"),
        islandsB: gl.getUniformLocation(progB, "u_islands"),
        iglassB: gl.getUniformLocation(progB, "u_iglass"),
        iglass2B: gl.getUniformLocation(progB, "u_iglass2"),
        aberrationB: gl.getUniformLocation(progB, "u_aberration"),
        specularB: gl.getUniformLocation(progB, "u_specular"),
        backdropLocB: gl.getUniformLocation(progB, "u_backdrop"),
        // Reduced motion freezes the animation clock; layout still redraws.
        animate: !reduced,
        dpr: () => Math.min((window.devicePixelRatio || 1) * tuningRef.current.renderScale, 3),
        resize,
      };
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, backdropTex);
      gl.uniform1i(scene.backdropLocB, 0);
      resize();

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
      if (scene) scene.resize();
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
              borderColor: alpha(scheme.tokens.primary, 0.25),
              borderTopColor: scheme.tokens.primary,
              animation: "glass-warm-spin 0.8s linear infinite",
              "@keyframes glass-warm-spin": { to: { transform: "rotate(360deg)" } },
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: scheme.tokens.onSurface, whiteSpace: "nowrap" }}
          >
            {warmStage}
          </Typography>
        </Box>
      )}
    </>
  );
}
