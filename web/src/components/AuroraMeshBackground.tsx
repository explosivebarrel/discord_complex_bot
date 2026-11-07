import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { useAppTheme } from "../themes/AppThemeContext";

/**
 * WebGL mesh variant of the aurora backdrop: every torus blob's gradient
 * stops become three drifting color blobs around the family's anchor, over
 * the theme's base background color — the Liquid Glass mesh look, denser
 * and stronger-warped. One tiny program (no textures, no lenses), so the
 * driver compile is fast; the classic canvas aurora stays the fallback.
 */

const MAX_BLOBS = 12; // 4 aurora families x 3 gradient stops

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ES1-style source: the same program runs on a WebGL2 and a WebGL1 context.
const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_intensity;
uniform float u_speed;
uniform vec3 u_base;
uniform vec4 u_blobs[${MAX_BLOBS}]; // xy anchor (uv), z radius, w weight
uniform vec3 u_colors[${MAX_BLOBS}];
uniform float u_rays;      // ray glow strength (0 = off)
uniform float u_rayLength; // ray length multiplier
uniform float u_rayRate;   // how often events fire (cycle speed multiplier)
// --- Sun-ray tuning: GLSL const globals are compile-time constants, ---
// --- the compiler inlines them, so this costs nothing at runtime    ---
const float RAY_EVENT_PERIOD = 11.0; // seconds between a blob's ray events
const float RAY_ACTIVE = 0.72;      // share of the cycle the rays are visible
const float RAY_ENV_IN = 0.35;      // fade-in share of the active window
const float RAY_FAN_OUTER = 0.38;   // fan outer half-angle, radians (~20 deg)
const float RAY_FAN_CORE = 0.12;    // fully lit inside this half-angle
const float RAY_COMB = 6.0;         // angular comb frequency (beam structure)
const float RAY_SHARPNESS = 1.8;    // higher = thinner, crisper rays
const float RAY_HAZE = 0.30;        // brightness of the haze between rays
const float RAY_DUST_FLOOR = 0.55;  // floor of the fbm dust modulation
const float RAY_RISE = 0.22;        // transparent center, then the ray fades in
const float RAY_LEN_BASE = 5.5;     // ray length, in blob radii (3-6x)
const float RAY_LEN_JITTER = 0.35;  // per-event length variation
const float HUE_SHIFT = 0.10;       // ray color rotation from the blob color
const float RAY_GAIN = 1.3;          // overall beam brightness
const float NEON_SAT = 0.75;        // saturation lift after the rotation
const float NEON_BRIGHT = 0.8;      // brightness lift after the rotation
// --- Backdrop and blob tuning ---
const float WARP_AMOUNT = 0.30;        // domain-warp strength (the "liquid" look)
const float WARP_SCALE = 1.6;          // noise frequency of the warp field
const float WARP_DRIFT = 0.07;         // how fast the warp field crawls (x u_speed)
const float BLOB_WANDER = 0.20;        // sub-blob drift radius around the anchor
const float BLOB_FREQ_BASE = 0.14;     // wander frequency of the first sub-blob
const float BLOB_FREQ_STEP = 0.05;     // wander frequency step per sub-blob
const float BLOB_BREATHE = 0.10;       // radius breathing amplitude
const float BLOB_FALLOFF = 2.8;        // gaussian edge softness (higher = tighter)
const float BRIDGE_MOTION_TILT = 0.45; // how much the fan leans toward the pair's motion
const float BRIDGE_AXIS_NORMAL = 0.75; // ...versus how much it stays on the gap normal
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
// Ray color: hue-rotate around the gray axis (Rodrigues rotation).
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a * 6.2831853);
  return c * ca + cross(k, c) * sin(a * 6.2831853) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * vec2(aspect, 1.0);
  // Liquid warp, a notch stronger than the glass mesh.
  p += WARP_AMOUNT * (vec2(
    fbm(p * WARP_SCALE + vec2(0.0, u_time * WARP_DRIFT * u_speed)),
    fbm(p * WARP_SCALE + vec2(5.2, -u_time * WARP_DRIFT * u_speed))) - 0.5);
  vec3 col = u_base;
  vec2 centers[${MAX_BLOBS}];
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    vec4 bp = u_blobs[i];
    if (bp.w < 0.005) continue;
    float fi = float(i);
    float t = u_time * u_speed;
    // Each sub-blob wanders around its family anchor with two harmonics
    // (unlike the glass mesh's single orbits) and the radius breathes.
    vec2 c = bp.xy * vec2(aspect, 1.0)
      + BLOB_WANDER * vec2(
        sin(t * (BLOB_FREQ_BASE + BLOB_FREQ_STEP * fi) + fi * 2.3) + 0.5 * sin(t * (0.043 + 0.012 * fi) + fi),
        cos(t * (0.11 + 0.04 * fi) + fi * 1.9));
    centers[i] = c;
    float rad = bp.z * (1.0 + BLOB_BREATHE * sin(t * 0.21 + fi * 1.3));
    float d = length((p - c) / max(rad, 0.05));
    col = mix(col, u_colors[i], exp(-d * d * BLOB_FALLOFF) * bp.w * u_intensity);
  }
  // Sun rays: every blob occasionally grows a fan of light cones from its
  // center - transparent at the center, brightening along the ray, fading
  // at the tip (the cartoon-sun look). Events are scheduled per blob by a
  // hash of the cycle index, so they fire at different times, not all at
  // once. Color: the blob's own color, hue-rotated.
  if (u_rays > 0.001) {
    for (int i = 0; i < ${MAX_BLOBS}; i++) {
      vec4 bp = u_blobs[i];
      if (bp.w < 0.005) continue;
      float fi = float(i);
      // Event schedule: a hash-desynced cycle per blob; the rays are only
      // alive during the first RAY_ACTIVE share of it, with soft in/out.
      float cyc = u_time * u_speed * u_rayRate / RAY_EVENT_PERIOD
        + hash12(vec2(fi, 3.7)) * 10.0;
      float ev = fract(cyc);
      if (ev > RAY_ACTIVE) continue;
      float env = smoothstep(0.0, RAY_ENV_IN, ev)
        * (1.0 - smoothstep(RAY_ACTIVE - RAY_ENV_IN, RAY_ACTIVE, ev));
      if (env < 0.003) continue;
      float evRnd = hash12(vec2(floor(cyc) * 7.13, fi * 5.1));
      float baseAng = evRnd * 6.2831853; // random fan direction per event
      float L = bp.z * RAY_LEN_BASE * u_rayLength
        * (1.0 - RAY_LEN_JITTER + RAY_LEN_JITTER * 2.0 * evRnd);
      vec2 op = p - centers[i];
      float r = length(op);
      if (r > L) continue;
      float ang = atan(op.y, op.x) - baseAng;
      ang = mod(ang + 3.14159265, 6.2831853) - 3.14159265;
      float fan = smoothstep(RAY_FAN_OUTER, RAY_FAN_CORE, abs(ang));
      if (fan < 0.01) continue;
      // Transparent at the center, full brightness mid-ray, gone at the tip.
      float tt = r / L;
      float radial = smoothstep(RAY_RISE, RAY_RISE + 0.22, tt)
        * (1.0 - smoothstep(0.72, 1.0, tt));
      float lobes = pow(0.5 + 0.5 * cos(ang * RAY_COMB + evRnd * 40.0), RAY_SHARPNESS);
      float dust = fbm(vec2(ang * 6.0 + evRnd * 31.0, r * 0.9 - u_time * u_speed * 0.5));
      float beam = fan * ((1.0 - RAY_HAZE) + RAY_HAZE * lobes)
        * (RAY_DUST_FLOOR + (1.0 - RAY_DUST_FLOOR) * dust) * radial;
      vec3 neon = hueShift(u_colors[i], HUE_SHIFT);
      float mx = max(neon.r, max(neon.g, neon.b));
      neon = neon / max(mx, 0.05) * (NEON_SAT + NEON_BRIGHT * mx);
      col += neon * beam * env * u_rays * u_intensity * RAY_GAIN;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Sub-blob offsets inside a family, in units of the family radius. */
const OFFSETS: Array<[number, number]> = [
  [-0.05, -0.04],
  [0.06, 0.02],
  [0.01, 0.07],
];

export function AuroraMeshBackground() {
  const { scheme, auroraTuning } = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Live settings: the scene mounts once per scheme and reads these per frame.
  const tuningRef = useRef(auroraTuning);
  tuningRef.current = auroraTuning;
  const cfg = scheme.aurora;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !cfg) return;
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return;

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn("aurora mesh shader:", gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("aurora mesh program:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // Family anchors from the CSS aurora, each gradient stop as a sub-blob.
    const blobs = new Float32Array(MAX_BLOBS * 4);
    const colors = new Float32Array(MAX_BLOBS * 3);
    let n = 0;
    for (const b of cfg.blobs) {
      b.colors.forEach((hex, k) => {
        if (n >= MAX_BLOBS || k >= OFFSETS.length) return;
        blobs.set([b.x + OFFSETS[k][0] * b.r, b.y + OFFSETS[k][1] * b.r, b.r * (0.62 + 0.1 * k), 0.85], n * 4);
        colors.set(hexRgb(hex), n * 3);
        n++;
      });
    }
    for (let i = n; i < MAX_BLOBS; i++) blobs.set([0, 0, 0, 0], i * 4);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uIntensity = gl.getUniformLocation(prog, "u_intensity");
    const uSpeed = gl.getUniformLocation(prog, "u_speed");
    const uBase = gl.getUniformLocation(prog, "u_base");
    const uBlobs = gl.getUniformLocation(prog, "u_blobs");
    const uColors = gl.getUniformLocation(prog, "u_colors");
    const uRays = gl.getUniformLocation(prog, "u_rays");
    const uRayLength = gl.getUniformLocation(prog, "u_rayLength");
    const uRayRate = gl.getUniformLocation(prog, "u_rayRate");
    // Base = the theme background the CSS aurora sits on (tokens.surface).
    const [br, bg, bb] = hexRgb(scheme.tokens.surface);
    gl.uniform3f(uBase, br, bg, bb);
    gl.uniform4fv(uBlobs, blobs);
    gl.uniform3fv(uColors, colors);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = true;
    let last = performance.now();
    let phase = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, window.innerWidth, window.innerHeight);
    };
    const draw = () => {
      gl.uniform1f(uTime, phase);
      gl.uniform1f(uIntensity, tuningRef.current.intensity);
      gl.uniform1f(uSpeed, tuningRef.current.speed);
      gl.uniform1f(uRays, tuningRef.current.rays);
      gl.uniform1f(uRayLength, tuningRef.current.rayLength);
      gl.uniform1f(uRayRate, tuningRef.current.rayRate);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
      phase += Math.min((now - last) / 1000, 0.1);
      last = now;
      draw();
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) draw();
    else raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cfg, scheme]);

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
