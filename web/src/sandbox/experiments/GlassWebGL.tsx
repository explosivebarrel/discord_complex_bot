import { useEffect, useRef } from "react";
import type { ExperimentDef } from "../registry";

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
uniform float u_specular;

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
  float ab = u_aberration * e;
  vec2 uvR = (backdropPx + dir * ab) / u_canvas;
  vec2 uvB = (backdropPx - dir * ab) / u_canvas;
  vec3 col;
  col.r = texture2D(u_backdrop, uvR).r;
  col.g = texture2D(u_backdrop, uv0).g;
  col.b = texture2D(u_backdrop, uvB).b;
  col = col * 0.96 + vec3(0.06, 0.05, 0.10);
  // Fresnel-ish specular rim, light from the top-left.
  vec2 n = normalize(local / half_ + vec2(0.0001, 0.0001));
  float rim = pow(e, 3.0);
  float l = max(dot(n, normalize(vec2(0.6, -0.8))), 0.0);
  col += u_specular * rim * (0.25 + 0.75 * l) * 0.6;
  gl_FragColor = vec4(col * inside, inside);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("sandbox shader:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

/**
 * Method 3 — a real WebGL refraction shader: the sandbox backdrop canvas
 * is uploaded as a texture and the fragment shader refracts it through a
 * rounded-box SDF rim, with chromatic aberration and a specular rim.
 */
function GlassWebGL({ params, width, height, offset, backdropCanvas, backdropVersion }: {
  params: Record<string, number>;
  width: number;
  height: number;
  offset: [number, number];
  backdropCanvas: HTMLCanvasElement | null;
  backdropVersion: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{ gl: WebGLRenderingContext; prog: WebGLProgram; tex: WebGLTexture } | null>(null);
  const failedRef = useRef(false);

  // GL setup, once.
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
      console.warn("sandbox program:", gl.getProgramInfoLog(prog));
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
  }, []);

  // (draw effect below re-runs on every render — params/size/offset/drag)

  // Redraw whenever anything changes; also (re)uploads the backdrop texture.
  useEffect(() => {
    void backdropVersion; // part of the implicit redraw contract
    const st = stateRef.current;
    const canvas = canvasRef.current;
    if (!st || !canvas || failedRef.current || !backdropCanvas) return;
    const { gl, prog, tex } = st;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, backdropCanvas);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    gl.uniform2f(u("u_res"), width, height);
    gl.uniform2f(u("u_offset"), offset[0], offset[1]);
    gl.uniform2f(u("u_canvas"), backdropCanvas.width, backdropCanvas.height);
    gl.uniform1f(u("u_radius"), params.radius);
    gl.uniform1f(u("u_bezel"), params.bezel);
    gl.uniform1f(u("u_refraction"), params.refraction);
    gl.uniform1f(u("u_aberration"), params.aberration);
    gl.uniform1f(u("u_specular"), params.specular);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  });

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

export const glassWebGLDef: ExperimentDef = {
  id: "glass-webgl",
  label: "Glass — WebGL shader",
  defaultSize: { w: 220, h: 150 },
  params: [
    { key: "radius", label: "Corner radius", min: 8, max: 60, step: 1, default: 24 },
    { key: "refraction", label: "Refraction, px", min: 0, max: 40, step: 1, default: 16 },
    { key: "bezel", label: "Lens band, px", min: 6, max: 40, step: 1, default: 24 },
    { key: "aberration", label: "Aberration, px", min: 0, max: 6, step: 0.5, default: 2 },
    { key: "specular", label: "Specular", min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  Component: GlassWebGL,
};
