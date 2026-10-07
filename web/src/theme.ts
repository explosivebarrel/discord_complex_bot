import { createTheme } from "@mui/material/styles";

declare module "@mui/material/Button" {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

// Material Design 3 dark scheme (baseline tonal palette).
const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#D0BCFF", contrastText: "#381E72" },
    secondary: { main: "#CCC2DC", contrastText: "#332D41" },
    error: { main: "#F2B8B5", contrastText: "#601410" },
    success: { main: "#6DD58C", contrastText: "#00391B" },
    background: { default: "#141218", paper: "#1D1B20" },
    text: { primary: "#E6E0E9", secondary: "#CAC4D0" },
    divider: "#49454F",
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
            backgroundColor: "#4A4458",
            color: "#E6E0E9",
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
        root: { backgroundImage: "none", border: "1px solid #2B2930" },
      },
      defaultProps: { elevation: 0 },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

export default theme;
