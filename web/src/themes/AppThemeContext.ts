import { createContext, useContext } from "react";
import { getScheme, type AppThemeScheme, type ThemeId } from "./palettes";

/** Backdrop scene rendered behind the Liquid Glass surfaces. */
export type GlassBackdrop = "mesh" | "stars-sparse" | "stars-medium" | "stars-dense" | "stripes" | "grid";

export const GLASS_BACKDROPS: { id: GlassBackdrop; label: string }[] = [
  { id: "stars-dense", label: "Stars — dense" },
  { id: "mesh", label: "Mesh gradient" },
  { id: "stars-medium", label: "Stars — medium" },
  { id: "stars-sparse", label: "Stars — sparse" },
  { id: "stripes", label: "Vertical stripes" },
  { id: "grid", label: "Checkerboard" },
];

export function getGlassBackdrop(v: string): GlassBackdrop {
  return (GLASS_BACKDROPS.some((o) => o.id === v) ? v : "stars-dense") as GlassBackdrop;
}

/**
 * Live-tunable Liquid Glass parameters (the settings dialog):
 * maxDisp — peak rim refraction in px; bezel — rim band thickness in px;
 * aberration — chromatic pull in px; specular — fresnel rim highlight
 * strength; renderScale — extra resolution multiplier on top of
 * devicePixelRatio (raise it on a strong GPU); lens tint / panel tint —
 * color + opacity of the glass tint over refracting surfaces and frosted
 * panels.
 */
export interface GlassTuning {
  maxDisp: number;
  bezel: number;
  aberration: number;
  specular: number;
  renderScale: number;
  /** Play button shading: panel frost (true) or the refraction lens. */
  fabFrost: boolean;
  /** Play button frost tuning (used when fabFrost is on). */
  fabBlur: number;
  fabTint: string;
  fabTintAlpha: number;
  lensTint: string;
  lensTintAlpha: number;
  panelTint: string;
  panelTintAlpha: number;
}

export const DEFAULT_GLASS_TUNING: GlassTuning = {
  maxDisp: 20,
  bezel: 20,
  aberration: 2,
  specular: 0.5,
  renderScale: 1,
  fabFrost: true,
  fabBlur: 22,
  fabTint: "#161028",
  fabTintAlpha: 0.45,
  lensTint: "#161028",
  lensTintAlpha: 0.25,
  panelTint: "#161028",
  panelTintAlpha: 0.45,
};

export function getGlassTuning(raw: string | null): GlassTuning {
  try {
    return { ...DEFAULT_GLASS_TUNING, ...JSON.parse(raw || "") };
  } catch {
    return DEFAULT_GLASS_TUNING;
  }
}

/** Aurora backdrop settings: canvas torus blobs (css) or the WebGL mesh
    built from the aurora gradients (mesh), with mesh intensity/speed. */
export interface AuroraTuning {
  mesh: boolean;
  intensity: number;
  speed: number;
}

export const DEFAULT_AURORA_TUNING: AuroraTuning = { mesh: false, intensity: 1, speed: 1 };

export function getAuroraTuning(raw: string | null): AuroraTuning {
  try {
    return { ...DEFAULT_AURORA_TUNING, ...JSON.parse(raw || "") };
  } catch {
    return DEFAULT_AURORA_TUNING;
  }
}

interface AppThemeState {
  scheme: AppThemeScheme;
  setThemeId: (id: ThemeId) => void;
  glassBackdrop: GlassBackdrop;
  setGlassBackdrop: (b: GlassBackdrop) => void;
  glassTuning: GlassTuning;
  setGlassTuning: (t: GlassTuning) => void;
  auroraTuning: AuroraTuning;
  setAuroraTuning: (t: AuroraTuning) => void;
  /** True when the Liquid Glass theme runs the full WebGL scene (procedural
      backdrop + shader lenses under every island); false falls back to the
      CSS frosted glass over the 2D canvas backdrop. */
  glassWebgl: boolean;
  /** Color-blind friendly status markers (Okabe-Ito based): a toggle in
      the theme menu, applied to the availability strips, the Right-now
      rows and the shell status chip in every theme. */
  cbPalette: boolean;
  setCbPalette: (v: boolean) => void;
}

export const AppThemeContext = createContext<AppThemeState>({
  scheme: getScheme("dark"),
  setThemeId: () => {},
  glassBackdrop: "stars-dense",
  setGlassBackdrop: () => {},
  glassTuning: DEFAULT_GLASS_TUNING,
  setGlassTuning: () => {},
  auroraTuning: DEFAULT_AURORA_TUNING,
  setAuroraTuning: () => {},
  glassWebgl: false,
  cbPalette: false,
  setCbPalette: () => {},
});

export function useAppTheme(): AppThemeState {
  return useContext(AppThemeContext);
}
