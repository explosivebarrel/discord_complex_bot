import { createContext, useContext } from "react";
import { getScheme, type AppThemeScheme, type ThemeId } from "./palettes";

/** Backdrop scene rendered behind the Liquid Glass surfaces. */
export type GlassBackdrop = "stars-sparse" | "stars-medium" | "stars-dense" | "stripes" | "grid";

export const GLASS_BACKDROPS: { id: GlassBackdrop; label: string }[] = [
  { id: "stars-sparse", label: "Stars — sparse" },
  { id: "stars-medium", label: "Stars — medium" },
  { id: "stars-dense", label: "Stars — dense" },
  { id: "stripes", label: "Vertical stripes" },
  { id: "grid", label: "Checkerboard" },
];

export function getGlassBackdrop(v: string): GlassBackdrop {
  return (GLASS_BACKDROPS.some((o) => o.id === v) ? v : "stars-sparse") as GlassBackdrop;
}

/**
 * Live-tunable lens parameters (sliders in the Liquid Glass settings):
 * maxDisp — peak rim displacement in px; bezel — rim band thickness in px;
 * dockBlur — frosted blur of the dock warp layer; scrim — content-column
 * tint opacity. The FAB derives its lens from maxDisp/bezel.
 */
export interface GlassTuning {
  maxDisp: number;
  bezel: number;
  dockBlur: number;
  scrim: number;
}

export const DEFAULT_GLASS_TUNING: GlassTuning = { maxDisp: 20, bezel: 20, dockBlur: 5, scrim: 0.15 };

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
}

export const AppThemeContext = createContext<AppThemeState>({
  scheme: getScheme("dark"),
  setThemeId: () => {},
  glassBackdrop: "stars-sparse",
  setGlassBackdrop: () => {},
  glassTuning: DEFAULT_GLASS_TUNING,
  setGlassTuning: () => {},
});

export function useAppTheme(): AppThemeState {
  return useContext(AppThemeContext);
}
