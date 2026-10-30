import { useTheme } from "@mui/material/styles";
import { useAppTheme } from "../themes/AppThemeContext";

export const DOWN_DARK = "#E5484D";

export interface StatusPalette {
  up: string;
  degraded: string;
  down: string;
}

const MARKERS: Record<"default" | "cb", Record<"dark" | "light", StatusPalette>> = {
  default: {
    // The light themes' success green is too close to the down red for a
    // deuteranope; the operational marker is a bright lettuce there, and
    // slightly lifted in dark themes so it holds against the reds.
    dark: { up: "#6DD58C", degraded: "#FFA738", down: DOWN_DARK },
    light: { up: "#4ADE80", degraded: "#E8930C", down: "#C63B3B" },
  },
  // Okabe-Ito derived: sky-blue operational and vermillion down stay
  // distinguishable for deuteranopia and protanopia alike.
  cb: {
    dark: { up: "#56B4E9", degraded: "#F0E442", down: "#D55E00" },
    light: { up: "#0072B2", degraded: "#E8C42A", down: "#D55E00" },
  },
};

/** Marker colors for status indicators (availability strips, Right-now
    rows, the shell status chip): theme mode plus the color-blind palette
    toggle from the theme menu. */
export function useStatusPalette(): StatusPalette {
  const mode = useTheme().palette.mode === "light" ? "light" : "dark";
  const { cbPalette } = useAppTheme();
  return MARKERS[cbPalette ? "cb" : "default"][mode];
}
