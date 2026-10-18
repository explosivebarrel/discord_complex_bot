import { alpha, createTheme, type Theme } from "@mui/material/styles";
import { mixHex, type AppThemeScheme, type M3Tokens } from "./palettes";

declare module "@mui/material/styles" {
  interface Palette {
    /** Full MD3 token set of the active theme (see themes/palettes.ts). */
    m3: M3Tokens;
  }
  interface PaletteOptions {
    m3?: M3Tokens;
  }
  interface Theme {
    surface: AppThemeScheme["surface"];
  }
  interface ThemeOptions {
    surface?: AppThemeScheme["surface"];
  }
}

declare module "@mui/material/Button" {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

/**
 * Background of a shell (frame, nav, sheets) or card surface, honoring the
 * active theme's translucency: plain themes get the solid token, animated
 * themes get an alpha plus a backdrop blur so the backdrop shows through.
 */
export function surfaceStyle(theme: Theme, base: string, tier: "shell" | "card") {
  const s = theme.surface;
  const a = tier === "shell" ? s.shellAlpha : s.cardAlpha;
  const blur = tier === "shell" ? s.shellBlur : s.cardBlur;
  return {
    bgcolor: a >= 1 ? base : alpha(base, a),
    ...(blur > 0 && { backdropFilter: `blur(${blur}px) saturate(${s.saturate})` }),
  };
}

const cache = new Map<string, Theme>();

export function buildTheme(scheme: AppThemeScheme): Theme {
  const hit = cache.get(scheme.id);
  if (hit) return hit;
  const t = scheme.tokens;
  const s = scheme.surface;
  const translucent = s.shellAlpha < 1 || s.cardAlpha < 1;
  const theme = createTheme({
    surface: s,
    palette: {
      mode: scheme.mode,
      m3: t,
      primary: { main: t.primary, contrastText: t.onPrimary },
      secondary: { main: t.secondary, contrastText: t.onSecondary },
      error: { main: t.error, contrastText: t.onError },
      success: { main: t.success, contrastText: t.onSuccess },
      background: { default: t.surface, paper: t.surfaceContainerLow },
      text: { primary: t.onSurface, secondary: t.onSurfaceVariant },
      divider: t.outlineVariant,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif",
      h4: { fontWeight: 500 },
      h5: { fontWeight: 500 },
      // Card and section titles. Page titles render once, in the AppShell
      // header, at 22px/500 — see the header Typography there.
      h6: { fontWeight: 600, fontSize: "1rem" },
      button: { textTransform: "none", fontWeight: 500 },
    },
    components: {
      MuiButton: {
        variants: [
          {
            // MD3 tonal button: secondary container.
            props: { variant: "tonal" },
            style: {
              backgroundColor: t.secondaryContainer,
              color: t.onSecondaryContainer,
              "&:hover": { backgroundColor: mixHex(t.secondaryContainer, t.onSecondaryContainer, 0.12) },
            },
          },
          {
            props: { variant: "contained", color: "primary" },
            style: { boxShadow: "none", "&:hover": { boxShadow: "none" } },
          },
        ],
        styleOverrides: { root: { borderRadius: 999 } },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            // MD3 filled card: one tone above the surface, no shadows.
            backgroundImage: "none",
            backgroundColor: s.cardAlpha >= 1 ? t.surfaceContainerLow : alpha(t.surfaceContainerLow, s.cardAlpha),
            ...(s.cardBlur > 0 && { backdropFilter: `blur(${s.cardBlur}px) saturate(${s.saturate})` }),
            // Translucent cards need a hairline to keep their edges over
            // the animated backdrop.
            ...(translucent && { border: `1px solid ${s.neonBorder ?? alpha(t.outlineVariant, 0.8)}` }),
            boxShadow: "none",
            borderRadius: 16,
          },
        },
        defaultProps: { elevation: 0 },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8 },
          // MUI's default 5px left margin is visibly narrower than the
          // label's 12px right padding; even them out.
          icon: { marginLeft: 12 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            "&.Mui-selected": {
              backgroundColor: t.secondaryContainer,
              color: t.onSecondaryContainer,
              "& .MuiListItemIcon-root": { color: t.onSecondaryContainer },
              "&:hover": { backgroundColor: t.secondaryContainer },
            },
          },
        },
      },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiCssBaseline: {
        styleOverrides: {
          // Thin MD3 scrollbars: outline-variant thumb on a transparent track.
          "*": { scrollbarWidth: "thin", scrollbarColor: `${t.secondaryContainer} transparent` },
          "*::-webkit-scrollbar": { width: 10, height: 10 },
          "*::-webkit-scrollbar-track": { background: "transparent" },
          "*::-webkit-scrollbar-thumb": {
            background: t.surfaceContainerHighest,
            borderRadius: 8,
            border: "2px solid transparent",
            backgroundClip: "padding-box",
          },
          "*::-webkit-scrollbar-thumb:hover": { background: t.secondaryContainer, backgroundClip: "padding-box" },
          "*::-webkit-scrollbar-corner": { background: "transparent" },
        },
      },
    },
  });
  cache.set(scheme.id, theme);
  return theme;
}
