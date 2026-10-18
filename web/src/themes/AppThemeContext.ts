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

interface AppThemeState {
  scheme: AppThemeScheme;
  setThemeId: (id: ThemeId) => void;
  glassBackdrop: GlassBackdrop;
  setGlassBackdrop: (b: GlassBackdrop) => void;
}

export const AppThemeContext = createContext<AppThemeState>({
  scheme: getScheme("dark"),
  setThemeId: () => {},
  glassBackdrop: "stars-sparse",
  setGlassBackdrop: () => {},
});

export function useAppTheme(): AppThemeState {
  return useContext(AppThemeContext);
}
