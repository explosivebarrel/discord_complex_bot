import { createTheme } from "@mui/material/styles";

declare module "@mui/material/Button" {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

/**
 * Material Design 3 baseline dark scheme tokens
 * (https://m3.material.io/styles/color/system/overview).
 * Components use these instead of scattered hex literals.
 */
export const m3 = {
  primary: "#D0BCFF",
  onPrimary: "#381E72",
  primaryContainer: "#4F378B",
  onPrimaryContainer: "#EADDFF",
  secondary: "#CCC2DC",
  onSecondary: "#332D41",
  secondaryContainer: "#4A4458",
  onSecondaryContainer: "#E8DEF8",
  tertiary: "#EFB8C8",
  tertiaryContainer: "#633B48",
  error: "#F2B8B5",
  onError: "#601410",
  errorContainer: "#8C1D18",
  onErrorContainer: "#F9DEDC",
  success: "#6DD58C",
  surface: "#141218",
  surfaceDim: "#141218",
  onSurface: "#E6E0E9",
  surfaceVariant: "#49454F",
  onSurfaceVariant: "#CAC4D0",
  surfaceContainerLowest: "#0F0D13",
  surfaceContainerLow: "#1D1B20",
  surfaceContainer: "#211F26",
  surfaceContainerHigh: "#2B2930",
  surfaceContainerHighest: "#36343B",
  outline: "#938F99",
  outlineVariant: "#49454F",
  inverseSurface: "#E6E0E9",
  inverseOnSurface: "#322F35",
  inversePrimary: "#6750A4",
  scrim: "#000000",
} as const;

// Material Design 3 dark scheme (baseline tonal palette).
const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: m3.primary, contrastText: m3.onPrimary },
    secondary: { main: m3.secondary, contrastText: m3.onSecondary },
    error: { main: m3.error, contrastText: m3.onError },
    success: { main: m3.success, contrastText: "#00391B" },
    background: { default: m3.surface, paper: m3.surfaceContainerLow },
    text: { primary: m3.onSurface, secondary: m3.onSurfaceVariant },
    divider: m3.outlineVariant,
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', sans-serif",
    h4: { fontWeight: 500 },
    h5: { fontWeight: 500 },
    h6: { fontWeight: 500, fontSize: "1.05rem" },
    button: { textTransform: "none", fontWeight: 500 },
  },
  components: {
    MuiButton: {
      variants: [
        {
          // MD3 tonal button: secondary container.
          props: { variant: "tonal" },
          style: {
            backgroundColor: m3.secondaryContainer,
            color: m3.onSecondaryContainer,
            "&:hover": { backgroundColor: "#565265" },
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
          backgroundColor: m3.surfaceContainerLow,
          boxShadow: "none",
          borderRadius: 16,
        },
      },
      defaultProps: { elevation: 0 },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          "&.Mui-selected": {
            backgroundColor: m3.secondaryContainer,
            color: m3.onSecondaryContainer,
            "& .MuiListItemIcon-root": { color: m3.onSecondaryContainer },
            "&:hover": { backgroundColor: m3.secondaryContainer },
          },
        },
      },
    },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiCssBaseline: {
      styleOverrides: {
        // Thin MD3 scrollbars: outline-variant thumb on a transparent track.
        "*": { scrollbarWidth: "thin", scrollbarColor: `${m3.secondaryContainer} transparent` },
        "*::-webkit-scrollbar": { width: 10, height: 10 },
        "*::-webkit-scrollbar-track": { background: "transparent" },
        "*::-webkit-scrollbar-thumb": {
          background: m3.surfaceContainerHighest,
          borderRadius: 8,
          border: "2px solid transparent",
          backgroundClip: "padding-box",
        },
        "*::-webkit-scrollbar-thumb:hover": { background: m3.secondaryContainer, backgroundClip: "padding-box" },
        "*::-webkit-scrollbar-corner": { background: "transparent" },
      },
    },
  },
});

export default theme;
