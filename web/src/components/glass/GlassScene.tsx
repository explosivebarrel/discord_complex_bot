import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { useAppTheme } from "../../themes/AppThemeContext";
import type { GlassBackdrop } from "../../themes/AppThemeContext";
import { BACKDROP_GLSL } from "./backdropGlsl";
import { glassIslandEntries } from "./glassRegistry";

const MAX_ISLANDS = 8;

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_aberration;
uniform float u_specular;
uniform vec4 u_islands[${MAX_ISLANDS}];   // rect: x, y, w, h (CSS px)
uniform vec4 u_iglass[${MAX_ISLANDS}];    // radius, tint rgb
uniform vec4 u_iglass2[${MAX_ISLANDS}];   // tintAlpha, bezel, maxDisp, blur

${BACKDROP_GLSL}

void main() {
  // v_uv is y-up (GL); the DOM and getBoundingClientRect are y-down.
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  float t = u_time;
  vec3 col = backdropColor(px, t);

  for (int i = 0; i < ${MAX_ISLANDS}; i++) {
    vec4 rc = u_islands[i];
    if (rc.z < 1.0) continue;
    float radius = min(u_iglass[i].x, min(rc.z, rc.w) * 0.5);
    vec2 half_ = rc.zw * 0.5 - 1.5;
    vec2 local = px - rc.xy - rc.zw * 0.5;
    float d = sdRoundBox(local, half_, radius);
    float inside = 1.0 - smoothstep(-0.5, 0.5, d);
    if (inside <= 0.001) {
      // Soft ambient shadow fading out from the panel edge — drawn into
      // the scene so it wraps the glass instead of a CSS rectangle.
      col *= 1.0 - exp(-max(d, 0.0) / 30.0) * 0.45;
      continue;
    }
    // The sandbox lens, ported 1:1: smoothstep-eased rim over the bezel
    // band, radial refraction peaking at maxDisp on the edge, per-channel
    // chromatic pull, a slight lift instead of a heavy tint, and a
    // fresnel-ish specular rim under a top-left light.
    float bezel = max(u_iglass2[i].y, 6.0);
    float depth = clamp(-d, 0.0, bezel);
    float e = 1.0 - depth / bezel;
    e = e * e * (3.0 - 2.0 * e);
    vec2 dir = normalize(local + vec2(0.0001, 0.0001));
    vec2 refr = px - dir * e * u_iglass2[i].z;
    float ab = u_aberration * e;
    vec3 glass;
    glass.r = backdropColor(refr + dir * ab, t).r;
    glass.g = backdropColor(refr, t).g;
    glass.b = backdropColor(refr - dir * ab, t).b;
    // The sandbox lift, rim-weighted: on a card-sized island it reads as
    // glass, but constant across a near-fullscreen panel it would wash the
    // whole interior out.
    glass = glass * mix(0.96, 1.0, e) + vec3(0.06, 0.05, 0.10) * e;
    glass = mix(glass, u_iglass[i].yzw, u_iglass2[i].x);
    float rim = pow(e, 3.0);
    float l = max(dot(normalize(local / half_ + vec2(0.0001, 0.0001)), normalize(vec2(0.6, -0.8))), 0.0);
    glass += u_specular * rim * (0.25 + 0.75 * l) * 0.6;
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
      webglProbe = !!c.getContext("webgl");
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

/**
 * The single WebGL scene behind the Liquid Glass theme: the procedural
 * backdrop (mesh gradient / star fields / stripes / checkerboard) plus
 * every registered glass island drawn by the same fragment shader — the
 * lens evaluates the backdrop at the refracted position, so the
 * refraction is float-exact with no textures and no CPU copies. One
 * context, one draw call, one rAF loop for the whole app.
 */
export function GlassScene() {
  const { glassBackdrop, glassTuning, scheme } = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) return;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("glass scene program:", gl.getProgramInfoLog(prog));
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
    const blobHex = [
      scheme.tokens.primaryContainer,
      scheme.tokens.tertiaryContainer,
      scheme.tokens.secondaryContainer,
      scheme.tokens.primary,
      scheme.tokens.tertiary,
    ];
    const blobs = new Float32Array(blobHex.flatMap(hexRgb));
    const rects = new Float32Array(MAX_ISLANDS * 4);
    const glassA = new Float32Array(MAX_ISLANDS * 4);
    const glassB = new Float32Array(MAX_ISLANDS * 4);
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");
    const uMode = gl.getUniformLocation(prog, "u_mode");
    const uBlobs = gl.getUniformLocation(prog, "u_blobs");
    const uAberration = gl.getUniformLocation(prog, "u_aberration");
    const uSpecular = gl.getUniformLocation(prog, "u_specular");
    const uIslands = gl.getUniformLocation(prog, "u_islands");
    const uIglass = gl.getUniformLocation(prog, "u_iglass");
    const uIglass2 = gl.getUniformLocation(prog, "u_iglass2");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    gl.uniform2f(uRes, window.innerWidth, window.innerHeight);
    gl.uniform1f(uMode, MODE[glassBackdrop]);
    gl.uniform3fv(uBlobs, blobs);
    gl.uniform1f(uAberration, 2);
    gl.uniform1f(uSpecular, 0.5);
    // Reduced motion freezes the animation clock; layout still redraws.
    const animate = !reduced;
    const t0 = performance.now();

    let raf = 0;
    let running = true;
    const frame = (now: number) => {
      if (!running) return;
      gl.uniform1f(uTime, animate ? (now - t0) / 1000 : 1.0);
      const entries = glassIslandEntries();
      let n = 0;
      for (const { el, radius, tint, tintAlpha } of entries) {
        if (n >= MAX_ISLANDS) break;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        rects.set([r.left, r.top, r.width, r.height], n * 4);
        const [tr, tg, tb] = hexRgb(tint ?? scheme.tokens.surfaceContainerLow);
        glassA.set([radius, tr, tg, tb], n * 4);
        glassB.set([tintAlpha ?? glassTuning.scrim, glassTuning.bezel, glassTuning.maxDisp, 0], n * 4);
        n++;
      }
      // Zero out unused slots so the shader skips them.
      rects.fill(0, n * 4);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        resize();
        gl.uniform2f(uRes, w, h);
      }
      gl.uniform4fv(uIslands, rects);
      gl.uniform4fv(uIglass, glassA);
      gl.uniform4fv(uIglass2, glassB);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => gl.uniform2f(uRes, window.innerWidth, window.innerHeight);
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
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Everything the scene reads at setup is intentionally captured once;
    // tuning changes come back as a remount through the deps below.
  }, [glassBackdrop, glassTuning, scheme]);

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
        pointerEvents: "none",
      }}
    />
  );
}
