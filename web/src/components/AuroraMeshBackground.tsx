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
uniform float u_bridges;
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
// Neon bridges: hue-rotate a color around the gray axis (Rodrigues).
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a * 6.2831853);
  return c * ca + cross(k, c) * sin(a * 6.2831853) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * vec2(aspect, 1.0);
  // Liquid warp, a notch stronger than the glass mesh.
  p += 0.30 * (vec2(
    fbm(p * 1.6 + vec2(0.0, u_time * 0.07 * u_speed)),
    fbm(p * 1.6 + vec2(5.2, -u_time * 0.06 * u_speed))) - 0.5);
  vec3 col = u_base;
  vec2 centers[${MAX_BLOBS}];
  vec2 centersPrev[${MAX_BLOBS}];
  for (int i = 0; i < ${MAX_BLOBS}; i++) {
    vec4 bp = u_blobs[i];
    if (bp.w < 0.005) continue;
    float fi = float(i);
    float t = u_time * u_speed;
    // Each sub-blob wanders around its family anchor with two harmonics
    // (unlike the glass mesh's single orbits) and the radius breathes.
    vec2 c = bp.xy * vec2(aspect, 1.0)
      + 0.20 * vec2(
        sin(t * (0.14 + 0.05 * fi) + fi * 2.3) + 0.5 * sin(t * (0.043 + 0.012 * fi) + fi),
        cos(t * (0.11 + 0.04 * fi) + fi * 1.9));
    centers[i] = c;
    centersPrev[i] = bp.xy * vec2(aspect, 1.0)
      + 0.20 * vec2(
        sin((t - 0.18) * (0.14 + 0.05 * fi) + fi * 2.3) + 0.5 * sin((t - 0.18) * (0.043 + 0.012 * fi) + fi),
        cos((t - 0.18) * (0.11 + 0.04 * fi) + fi * 1.9));
    float rad = bp.z * (1.0 + 0.10 * sin(t * 0.21 + fi * 1.3));
    float d = length((p - c) / max(rad, 0.05));
    col = mix(col, u_colors[i], exp(-d * d * 2.8) * bp.w * u_intensity);
  }
  // God rays: when two blobs drift close, light cones spray out of the
  // contact zone between their surfaces - a fan of discrete rays with a
  // dusty haze, per-ray brightness, hue-rotated mid-color of the pair.
  // The fan points along the gap normal, tilted toward the pair's motion;
  // ray length and brightness ride on how close the pair got.
  if (u_bridges > 0.001) {
    for (int i = 0; i < ${MAX_BLOBS}; i++) {
      vec4 bi = u_blobs[i];
      if (bi.w < 0.005) continue;
      for (int j = 0; j < ${MAX_BLOBS}; j++) {
        if (j <= i) continue;
        vec4 bj = u_blobs[j];
        if (bj.w < 0.005) continue;
        vec2 ci = centers[i];
        vec2 cj = centers[j];
        vec2 ab = cj - ci;
        float dist = max(length(ab), 0.0001);
        float touch = (bi.z + bj.z) * 1.45; // bridging begins within this gap
        float near = 1.0 - smoothstep(touch * 0.2, touch, dist);
        if (near < 0.02) continue;
        vec2 dir = ab / dist;
        // Contact point: halfway through the gap between the surfaces.
        vec2 origin = ci + dir * (bi.z + max(dist - bi.z - bj.z, 0.0) * 0.5);
        // Fan axis: the gap normal (light leaks sideways out of the gap),
        // tilted toward where the pair is drifting.
        vec2 n = vec2(-dir.y, dir.x);
        vec2 vpair = (centers[i] + centers[j]) - (centersPrev[i] + centersPrev[j]);
        n = dot(n, vpair) < 0.0 ? -n : n;
        vec2 axis = normalize(n * 0.75 + normalize(vpair + vec2(0.0001, 0.0001)) * 0.45);
        float rnd = hash12(vec2(float(i) * 13.7, float(j) * 7.1));
        // Cone window around the axis, then discrete rays: an angular comb
        // plus fbm streaks - the dust lit up inside the beam.
        vec2 op = p - origin;
        float r = length(op);
        float ang = atan(op.y, op.x) - atan(axis.y, axis.x);
        ang = mod(ang + 3.14159265, 6.2831853) - 3.14159265;
        float fan = smoothstep(0.95, 0.3, abs(ang));
        if (fan < 0.01 || r > (bi.z + bj.z) * 2.1) continue;
        float lobes = pow(0.5 + 0.5 * cos(ang * 14.0 + rnd * 40.0), 2.6);
        float dust = fbm(vec2(ang * 7.0 + rnd * 31.0, r * 2.6 - u_time * u_speed * 0.5));
        float L = (bi.z + bj.z) * (0.55 + 1.3 * near) * (0.75 + 0.5 * rnd);
        float beam = fan * (0.30 + 0.70 * lobes) * (0.45 + 0.55 * dust) * exp(-r / max(L, 0.05));
        float strength = near * near * u_bridges * u_intensity;
        vec3 neon = hueShift((u_colors[i] + u_colors[j]) * 0.5, 0.10);
        float mx = max(neon.r, max(neon.g, neon.b));
        neon = neon / max(mx, 0.05) * (0.45 + 0.35 * mx);
        col += neon * beam * strength * 0.7;
        // Hot contact point where the surfaces almost touch.
        float hd = length(p - origin);
        col += neon * exp(-(hd * hd) / (min(bi.z, bj.z) * min(bi.z, bj.z) * 0.05)) * near * near * u_bridges * u_intensity * 0.35;
      }
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
    const uBridges = gl.getUniformLocation(prog, "u_bridges");
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
      gl.uniform1f(uBridges, tuningRef.current.bridges);
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
