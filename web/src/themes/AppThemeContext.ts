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
 * Live-tunable lens parameters (sliders in the Liquid Glass settings):
 * maxDisp — peak rim refraction in px; bezel — rim band thickness in px;
 * scrim — glass tint opacity (0 = the clean sandbox look).
 */
export interface GlassTuning {
  maxDisp: number;
  bezel: number;
  scrim: number;
}

export const DEFAULT_GLASS_TUNING: GlassTuning = { maxDisp: 20, bezel: 20, scrim: 0 };

export function getGlassTuning(raw: string | null): GlassTuning {
  try {
    return { ...DEFAULT_GLASS_TUNING, ...JSON.parse(raw || "") };
  } catch {
    return DEFAULT_GLASS_TUNING;
  }
}

interface AppThemeState {
  scheme: AppThemeScheme;
  setThemeId: (id: ThemeId) => void;
  glassBackdrop: GlassBackdrop;
  setGlassBackdrop: (b: GlassBackdrop) => void;
  glassTuning: GlassTuning;
  setGlassTuning: (t: GlassTuning) => void;
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
  glassWebgl: false,
  cbPalette: false,
  setCbPalette: () => {},
});

export function useAppTheme(): AppThemeState {
  return useContext(AppThemeContext);
}
