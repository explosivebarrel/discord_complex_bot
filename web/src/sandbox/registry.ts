import type { FC } from "react";
import { glassPinchDef } from "./experiments/GlassPinch";
import { glassSnellDef } from "./experiments/GlassSnell";
import { glassSvgShaderDef } from "./experiments/GlassSvgShader";
import { glassWebGLDef } from "./experiments/GlassWebGL";

/** A tunable number rendered as a slider in the sandbox inspector. */
export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

/** What an experiment component receives from the sandbox. */
export interface ExperimentProps {
  params: Record<string, number>;
  width: number;
  height: number;
  /** Card top-left inside the backdrop canvas, in px (for shader sampling). */
  offset: [number, number];
  /** The sandbox backdrop canvas — a texture source for shader experiments. */
  backdropCanvas: HTMLCanvasElement | null;
  /** Increments whenever the backdrop is redrawn (resize/backdrop change). */
  backdropVersion: number;
}

/**
 * A sandbox experiment: a self-contained visual test rendered inside a
 * draggable rounded card. Adding a new experiment = implementing the
 * component and appending one entry here; the canvas, drag logic and
 * inspector are generic and never mention specific experiments.
 */
export interface ExperimentDef {
  id: string;
  label: string;
  defaultSize: { w: number; h: number };
  params: ParamSpec[];
  Component: FC<ExperimentProps>;
}

export function defaultParams(def: ExperimentDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** All registered sandbox experiments, in palette order. */
export const EXPERIMENTS: ExperimentDef[] = [
  glassPinchDef,
  glassSnellDef,
  glassWebGLDef,
  glassSvgShaderDef,
];
