import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { glassCanvasHolder } from "./GlassBackground";

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_backdrop;
uniform vec2 u_res;
uniform vec2 u_offset;
uniform vec2 u_canvas;
uniform float u_radius;
uniform float u_bezel;
uniform float u_refraction;
uniform float u_aberration;
uniform float u_blur;
uniform vec3 u_tint;
uniform float u_tintAlpha;
uniform float u_specular;
uniform float u_alpha;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  vec2 p = v_uv * u_res;
  vec2 half_ = u_res * 0.5;
  vec2 local = p - half_;
  float d = sdRoundBox(local, half_ - 1.5, u_radius);
  float inside = 1.0 - smoothstep(-0.5, 0.5, d);
  float depth = clamp(-d, 0.0, u_bezel);
  float e = 1.0 - depth / u_bezel;
  e = e * e * (3.0 - 2.0 * e);
  vec2 dir = normalize(local + vec2(0.0001, 0.0001));
  // Refraction: the rim samples toward the center, magnifying the edge.
  vec2 backdropPx = u_offset + p - dir * e * u_refraction;
  vec2 uv0 = backdropPx / u_canvas;
  // Cheap frosted blur: five taps at the blur radius.
  vec2 b = vec2(u_blur) / u_canvas;
  vec3 col = (
    texture2D(u_backdrop, uv0).rgb +
    texture2D(u_backdrop, uv0 + vec2(b.x, b.y)).rgb +
    texture2D(u_backdrop, uv0 + vec2(-b.x, b.y)).rgb +
    texture2D(u_backdrop, uv0 + vec2(b.x, -b.y)).rgb +
    texture2D(u_backdrop, uv0 + vec2(-b.x, -b.y)).rgb) * 0.2;
  // Chromatic aberration on the rim only.
  float ab = u_aberration * e;
  col.r = texture2D(u_backdrop, (backdropPx + dir * ab) / u_canvas).r;
  col.b = texture2D(u_backdrop, (backdropPx - dir * ab) / u_canvas).b;
  // Panel tint (the content scrim, folded into the glass) + specular rim.
  col = mix(col, u_tint, u_tintAlpha);
  vec2 n = normalize(local / half_ + vec2(0.0001, 0.0001));
  float rim = pow(e, 3.0);
  float l = max(dot(n, normalize(vec2(0.6, -0.8))), 0.0);
  col += u_specular * rim * (0.25 + 0.75 * l) * 0.5;
  float alpha = inside * u_alpha * (0.55 + 0.45 * e);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("webgl glass:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

interface GlState {
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  tex: WebGLTexture;
}

/**
 * True WebGL liquid glass for an app panel: the live glass backdrop canvas
 * (stars/stripes/checker — rendered by GlassBackground) is uploaded as a
 * texture and a fragment shader renders the panel through a rounded-box
 * lens — refraction, chromatic aberration, frosted blur, tint and a
 * specular rim. Redraws every frame at GPU cost ~one textured quad;
 * the animating backdrop texture re-uploads on a slower cadence. DOM
 * content is intentionally not sampled: under islands-glass panels the
 * visible backdrop is our own canvas, so nothing is missed.
 */
export function WebGLGlass({
  radius,
  bezel,
  refraction,
  aberration,
  blur,
  tint,
  tintAlpha,
  specular = 0.45,
  alpha = 0.94,
  refreshMs = 200,
}: {
  radius: number;
  bezel: number;
  refraction: number;
  aberration: number;
  blur: number;
  tint: string;
  tintAlpha: number;
  specular?: number;
  alpha?: number;
  refreshMs?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GlState | null>(null);
  const failedRef = useRef(false);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const hexRgb = (hex: string): [number, number, number] => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // GL setup, once per mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) {
      failedRef.current = true;
      return;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      failedRef.current = true;
      return;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("webgl glass program:", gl.getProgramInfoLog(prog));
      failedRef.current = true;
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    stateRef.current = { gl, prog, tex };
  }, [alpha]);

  // Render loop: draws every frame (one textured quad), re-uploads the
  // animating backdrop texture on a slower cadence, tracks size/position.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let running = true;
    let lastUpload = 0;

    const frame = (t: number) => {
      if (!running) return;
      const st = stateRef.current;
      const box = canvas.parentElement;
      const src = glassCanvasHolder.canvas;
      if (st && box && src && !failedRef.current) {
        const { gl, prog, tex } = st;
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (w > 0 && h > 0 && (sizeRef.current.w !== w || sizeRef.current.h !== h)) {
          sizeRef.current = { w, h };
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
        if (canvas.width > 0) {
          const rect = box.getBoundingClientRect();
          if (t - lastUpload > refreshMs) {
            lastUpload = t;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          }
          gl.useProgram(prog);
          gl.uniform2f(gl.getUniformLocation(prog, "u_res"), w, h);
          gl.uniform2f(gl.getUniformLocation(prog, "u_offset"), rect.left, rect.top);
          // The backdrop canvas is rasterized at devicePixelRatio; the lens
          // works in CSS pixels, so divide the texture size back down.
          const scale = glassCanvasHolder.scale || 1;
          gl.uniform2f(gl.getUniformLocation(prog, "u_canvas"), src.width / scale, src.height / scale);
          gl.uniform1f(gl.getUniformLocation(prog, "u_radius"), radius);
          gl.uniform1f(gl.getUniformLocation(prog, "u_bezel"), bezel);
          gl.uniform1f(gl.getUniformLocation(prog, "u_refraction"), refraction);
          gl.uniform1f(gl.getUniformLocation(prog, "u_aberration"), aberration);
          gl.uniform1f(gl.getUniformLocation(prog, "u_blur"), blur);
          const [tr, tg, tb] = hexRgb(tint);
          gl.uniform3f(gl.getUniformLocation(prog, "u_tint"), tr / 255, tg / 255, tb / 255);
          gl.uniform1f(gl.getUniformLocation(prog, "u_tintAlpha"), tintAlpha);
          gl.uniform1f(gl.getUniformLocation(prog, "u_specular"), specular);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [radius, bezel, refraction, aberration, blur, tint, tintAlpha, specular, alpha, refreshMs]);

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      aria-hidden
      sx={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%", pointerEvents: "none", borderRadius: "inherit" }}
    />
  );
}
