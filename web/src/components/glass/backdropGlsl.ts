/**
 * The procedural backdrop, evaluated in GLSL by both the background pass
 * and the island lenses. Working in a single shader means a lens can call
 * `backdropColor()` at any (refracted) position — float math, no texture
 * reads, no 8-bit displacement maps — which is what makes the refraction
 * clean instead of banded.
 *
 * Coordinates: `px` is a viewport position in CSS pixels (y down, matching
 * getBoundingClientRect), `t` is seconds. Modes (uniform u_mode):
 * 0 mesh gradient (colors from the theme palette), 1/2/3 star fields
 * (sparse/medium/dense), 4 vertical stripes, 5 checkerboard.
 */
export const BACKDROP_GLSL = `
uniform vec2 u_res;    // viewport size in CSS px
uniform float u_mode;
uniform vec3 u_blobs[5]; // mesh gradient colors from the theme palette

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

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// One twinkling star per hash-grid cell (probability by density); the dot
// is a soft gaussian so the lens has a smooth field to refract.
vec3 starField(vec2 px, float t, float cellPx, float density) {
  vec2 cell = px / cellPx;
  vec2 id = floor(cell);
  vec2 f = fract(cell) - 0.5;
  float h = hash12(id);
  float present = step(1.0 - density, h);
  if (present < 0.5) return vec3(0.0);
  vec2 jitter = (vec2(hash12(id + 7.3), hash12(id + 3.1)) - 0.5) * 0.8;
  float dd = length(f - jitter);
  float rCells = (0.4 + 1.3 * hash12(id + 11.0)) / cellPx;
  float glow = exp(-dd * dd / (2.0 * rCells * rCells * 1.6));
  float base = 0.22 + 0.45 * hash12(id + 13.7);
  float amp = 0.12 + 0.35 * hash12(id + 19.3);
  float phase = hash12(id + 5.0) * 6.2831;
  float speed = 0.4 + 1.4 * hash12(id + 9.7);
  float tw = base + amp * sin(phase + t * speed);
  return vec3(0.910, 0.890, 1.0) * glow * clamp(tw, 0.05, 1.0);
}

// A meteor streak every ~12s, fully deterministic from the cycle number.
vec3 meteor(vec2 vn, float t) {
  float period = 12.0;
  float tt = mod(t, period);
  if (tt > 1.1) return vec3(0.0);
  float cyc = floor(t / period);
  float s = hash12(vec2(cyc, 17.0));
  vec2 a = vec2(mix(0.02, 0.7, s), mix(0.02, 0.25, hash12(vec2(cyc, 3.0))));
  vec2 dirv = normalize(vec2(0.9, 0.5) + 0.25 * vec2(s - 0.5, hash12(vec2(cyc, 9.0)) - 0.5));
  float p = tt / 1.1;
  vec2 head = a + dirv * p * 0.5;
  vec2 tail = head - dirv * 0.12;
  float d = sdSegment(vn, tail, head);
  return vec3(0.910, 0.890, 1.0) * exp(-d * 150.0) * (1.0 - p) * 0.9;
}

vec3 backdropColor(vec2 px, float t) {
  vec2 vn = px / u_res;
  if (u_mode < 0.5) {
    // Mesh gradient: dark base with five drifting palette blobs, warped
    // by a slow fbm so the edges stay liquid.
    float aspect = u_res.x / max(u_res.y, 1.0);
    vec2 p = vn * vec2(aspect, 1.0);
    p += 0.22 * (vec2(fbm(p * 1.8 + vec2(0.0, t * 0.06)), fbm(p * 1.8 + vec2(5.2, -t * 0.05))) - 0.5);
    vec3 col = vec3(0.031, 0.020, 0.070); // #080512
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = vec2(
        0.5 + 0.45 * sin(t * (0.11 + 0.05 * fi) + fi * 2.1),
        0.5 + 0.45 * cos(t * (0.09 + 0.04 * fi) + fi * 1.7));
      float d = length((p - c) / vec2(0.55, 0.62));
      col = mix(col, u_blobs[i], exp(-d * d * 3.2) * 0.85);
    }
    return col;
  }
  if (u_mode < 3.5) {
    // Star fields: deep base, the lilac rake light from the left, stars.
    vec3 col = vec3(0.051, 0.039, 0.094); // #0d0a18
    float density = u_mode < 1.5 ? 0.16 : (u_mode < 2.5 ? 0.4 : 0.85);
    float cell = u_mode < 1.5 ? 34.0 : (u_mode < 2.5 ? 24.0 : 15.0);
    col += starField(px, t, cell, density);
    col += meteor(vn, t);
    float rake = exp(-length((vn - vec2(-0.18, 0.42)) * vec2(1.35, 0.62)) * 2.2);
    col += vec3(0.839, 0.769, 1.0) * rake * 0.30;
    return col;
  }
  if (u_mode < 4.5) {
    // Vertical stripes: high-contrast bars, the best lens calibration.
    float s = mod(floor(px.x / 90.0), 2.0);
    vec3 col = mix(vec3(0.043, 0.043, 0.063), vec3(0.925, 0.918, 0.941), s); // #0b0b10 / #eceaf0
    float rake = exp(-length((vn - vec2(-0.18, 0.42)) * vec2(1.35, 0.62)) * 2.2);
    return col * (1.0 - rake * 0.35) + vec3(0.839, 0.769, 1.0) * rake * 0.18;
  }
  // Checkerboard.
  vec2 cc = floor(px / 44.0);
  float ck = mod(cc.x + cc.y, 2.0);
  return mix(vec3(0.086, 0.071, 0.122), vec3(0.839, 0.824, 0.871), ck); // #16121f / #d6d2de
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
`;
