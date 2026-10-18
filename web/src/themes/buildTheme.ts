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
 * Glass tiers (blur > 0) also gain a brightness lift and a specular
 * highlight along the top edge — the base "liquid glass" read.
 */
export function surfaceStyle(theme: Theme, base: string, tier: "shell" | "card") {
  const s = theme.surface;
  const a = tier === "shell" ? s.shellAlpha : s.cardAlpha;
  const blur = tier === "shell" ? s.shellBlur : s.cardBlur;
  const dark = theme.palette.mode === "dark";
  return {
    bgcolor: a >= 1 ? base : alpha(base, a),
    ...(blur > 0 && {
      backdropFilter: `blur(${blur}px) saturate(${s.saturate})${dark ? " brightness(1.08)" : ""}`,
      boxShadow: `inset 0 1px 0 ${alpha("#FFFFFF", dark ? 0.1 : 0.35)}`,
    }),
  };
}

/**
 * A single floating glass panel of the "islands" architecture: light blur,
 * saturation + contrast (liquid glass, not frosted), a top-edge specular,
 * a gradient hairline and a soft shadow. Sibling panels only — never nest
 * one glass element inside another (nested backdrop roots double-filter).
 */
export function islandStyle(theme: Theme, base: string) {
  const s = theme.surface;
  const dark = theme.palette.mode === "dark";
  return {
    bgcolor: alpha(base, s.shellAlpha),
    backdropFilter: `blur(${s.shellBlur}px) saturate(${s.saturate}) contrast(1.12)${dark ? " brightness(1.08)" : ""}`,
    boxShadow: `inset 0 1px 0 ${alpha("#FFFFFF", dark ? 0.22 : 0.4)}, 0 12px 40px rgba(0,0,0,.35)`,
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
            // MD3 tonal button: secondary container; on islands-glass themes
            // it becomes a small liquid-glass pill (tint + backdrop blur +
            // specular/border insets — CSS only, cheap enough for many).
            props: { variant: "tonal" },
            style: translucent
              ? {
                  backgroundColor: alpha(t.surfaceContainerHighest, 0.35),
                  color: t.onSurface,
                  backdropFilter: "blur(3px) saturate(1.4) contrast(1.1)",
                  boxShadow: `inset 0 1px 0 ${alpha("#FFFFFF", 0.22)}, inset 0 0 0 1px ${alpha("#FFFFFF", 0.1)}`,
                  "&:hover": {
                    backgroundColor: alpha(t.surfaceContainerHighest, 0.5),
                    boxShadow: `inset 0 1px 0 ${alpha("#FFFFFF", 0.22)}, inset 0 0 0 1px ${alpha("#FFFFFF", 0.12)}, 0 4px 14px rgba(0,0,0,.25)`,
                  },
                }
              : {
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
            backgroundImage:
              s.cardBlur > 0
                ? // Glass tier: a faint diagonal sheen over the surface.
                  `linear-gradient(135deg, ${alpha("#FFFFFF", scheme.mode === "dark" ? 0.06 : 0.2)}, transparent 45%)`
                : "none",
            backgroundColor: s.cardAlpha >= 1 ? t.surfaceContainerLow : alpha(t.surfaceContainerLow, s.cardAlpha),
            ...(s.cardBlur > 0 && {
              backdropFilter: `blur(${s.cardBlur}px) saturate(${s.saturate}) contrast(1.12)${scheme.mode === "dark" ? " brightness(1.08)" : ""}`,
              // "&&" out-specifies the Paper elevation shadow, which would
              // otherwise override the glass speculars.
              "&&": {
                boxShadow: `inset 0 1px 0 ${alpha("#FFFFFF", scheme.mode === "dark" ? 0.16 : 0.45)}, 0 10px 30px rgba(0,0,0,.30)`,
              },
            }),
            // Translucent cards need a hairline to keep their edges over
            // the animated backdrop.
            ...(translucent && { border: `1px solid ${s.neonBorder ?? alpha(t.outlineVariant, 0.8)}` }),
            ...(s.cardBlur === 0 && { boxShadow: "none" }),
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
