/**
 * App themes: one full Material Design 3 color-system token set per theme
 * (https://m3.material.io/styles/color/system/overview) plus how its
 * surfaces treat the backdrop (opaque for plain themes, translucent with
 * backdrop blur for the animated ones).
 */

export interface M3Tokens {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  onSuccess: string;
  surface: string;
  surfaceDim: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
}

export type ThemeId =
  | "dark"
  | "light"
  | "light-contrast"
  | "purple"
  | "peach"
  | "aurora-light"
  | "aurora-dark"
  | "glass";

export interface SurfaceTreatment {
  /** 1 = opaque surfaces; below 1 the animated backdrop shows through. */
  shellAlpha: number;
  cardAlpha: number;
  /** backdrop blur radius in px (0 = no backdrop-filter). */
  shellBlur: number;
  cardBlur: number;
  /** Extra saturation of the glass backdrop-filter. */
  saturate: number;
  /** Hairline color of glass edges (falls back to outlineVariant). */
  neonBorder?: string;
}

export interface AuroraBlob {
  /** Center as a fraction of the viewport; r as a fraction of its smaller side. */
  x: number;
  y: number;
  r: number;
  /** Ring colors cycling from the center outward. */
  colors: [string, string, string];
  /** Edge wobble amplitude as a fraction of the radius. */
  wobble: number;
  /** Gradient cycle speed: band positions per second, center -> outward. */
  drift: number;
}

export interface AuroraConfig {
  /** Thin contrast ring drawn at every color band boundary. */
  separator: string;
  /** Additive blending: glowing rings on dark backgrounds. */
  glow: boolean;
  blobs: AuroraBlob[];
}

export interface AppThemeScheme {
  id: ThemeId;
  label: string;
  mode: "light" | "dark";
  tokens: M3Tokens;
  surface: SurfaceTreatment;
  /** Aurora blob config; its presence turns on AuroraBackground. */
  aurora?: AuroraConfig;
}

const OPAQUE: SurfaceTreatment = { shellAlpha: 1, cardAlpha: 1, shellBlur: 0, cardBlur: 0, saturate: 1 };

/** Blends two "#rrggbb" colors; t=0 returns a, t=1 returns b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) + t * (((pb >> shift) & 255) - ((pa >> shift) & 255)));
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

const dark: AppThemeScheme = {
  id: "dark",
  label: "Dark",
  mode: "dark",
  surface: OPAQUE,
  tokens: {
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
    onTertiaryContainer: "#FFD8E4",
    error: "#F2B8B5",
    onError: "#601410",
    errorContainer: "#8C1D18",
    onErrorContainer: "#F9DEDC",
    success: "#6DD58C",
    onSuccess: "#00391B",
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
  },
};

const light: AppThemeScheme = {
  id: "light",
  label: "Light",
  mode: "light",
  surface: OPAQUE,
  tokens: {
    primary: "#6750A4",
    onPrimary: "#FFFFFF",
    primaryContainer: "#EADDFF",
    onPrimaryContainer: "#21005D",
    secondary: "#625B71",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#E8DEF8",
    onSecondaryContainer: "#1D192B",
    tertiary: "#7D5260",
    tertiaryContainer: "#FFD8E4",
    onTertiaryContainer: "#31111D",
    error: "#B3261E",
    onError: "#FFFFFF",
    errorContainer: "#F9DEDC",
    onErrorContainer: "#410E0B",
    success: "#146C2E",
    onSuccess: "#FFFFFF",
    surface: "#FEF7FF",
    surfaceDim: "#DED8E1",
    onSurface: "#1D1B20",
    surfaceVariant: "#E7E0EC",
    onSurfaceVariant: "#49454F",
    surfaceContainerLowest: "#FFFFFF",
    surfaceContainerLow: "#F7F2FA",
    surfaceContainer: "#F3EDF7",
    surfaceContainerHigh: "#ECE6F0",
    surfaceContainerHighest: "#E6E0E9",
    outline: "#79747E",
    outlineVariant: "#CAC4D0",
    inverseSurface: "#322F35",
    inverseOnSurface: "#F5EFF7",
    inversePrimary: "#D0BCFF",
    scrim: "#000000",
  },
};

// Same violet hue as Light, but darker text, stronger outlines and whiter
// containers: tuned for bright rooms and accessibility.
const lightContrast: AppThemeScheme = {
  id: "light-contrast",
  label: "Light contrast",
  mode: "light",
  surface: OPAQUE,
  tokens: {
    primary: "#4F378B",
    onPrimary: "#FFFFFF",
    primaryContainer: "#6750A4",
    onPrimaryContainer: "#FFFFFF",
    secondary: "#46404F",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#625B71",
    onSecondaryContainer: "#FFFFFF",
    tertiary: "#5C3A47",
    tertiaryContainer: "#7D5260",
    onTertiaryContainer: "#FFFFFF",
    error: "#8C1D18",
    onError: "#FFFFFF",
    errorContainer: "#B3261E",
    onErrorContainer: "#FFFFFF",
    success: "#0B5A22",
    onSuccess: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceDim: "#D5D0DC",
    onSurface: "#111013",
    surfaceVariant: "#DFD9E7",
    onSurfaceVariant: "#3A3540",
    surfaceContainerLowest: "#FFFFFF",
    surfaceContainerLow: "#F8F6FB",
    surfaceContainer: "#F2F0F6",
    surfaceContainerHigh: "#ECEAF1",
    surfaceContainerHighest: "#E6E3EC",
    outline: "#5F5A68",
    outlineVariant: "#B5AEBC",
    inverseSurface: "#111013",
    inverseOnSurface: "#FFFFFF",
    inversePrimary: "#EADDFF",
    scrim: "#000000",
  },
};

// Dark like the default theme, but every surface is shifted to violet.
const purple: AppThemeScheme = {
  id: "purple",
  label: "Purple",
  mode: "dark",
  surface: OPAQUE,
  tokens: {
    primary: "#D0BCFF",
    onPrimary: "#381E72",
    primaryContainer: "#4F378B",
    onPrimaryContainer: "#EADDFF",
    secondary: "#CCC2DC",
    onSecondary: "#332D41",
    secondaryContainer: "#514471",
    onSecondaryContainer: "#E8DEF8",
    tertiary: "#EFB8C8",
    tertiaryContainer: "#633B48",
    onTertiaryContainer: "#FFD8E4",
    error: "#F2B8B5",
    onError: "#601410",
    errorContainer: "#8C1D18",
    onErrorContainer: "#F9DEDC",
    success: "#6DD58C",
    onSuccess: "#00391B",
    surface: "#171225",
    surfaceDim: "#171225",
    onSurface: "#E6E0F4",
    surfaceVariant: "#4D4566",
    onSurfaceVariant: "#CFC5E5",
    surfaceContainerLowest: "#120D1F",
    surfaceContainerLow: "#1F1932",
    surfaceContainer: "#241D3A",
    surfaceContainerHigh: "#2F2748",
    surfaceContainerHighest: "#3A3156",
    outline: "#958DAE",
    outlineVariant: "#4D4566",
    inverseSurface: "#E6E0F4",
    inverseOnSurface: "#362E4C",
    inversePrimary: "#6750A4",
    scrim: "#000000",
  },
};

// Light warm theme built around peach and terracotta hues.
const peach: AppThemeScheme = {
  id: "peach",
  label: "Peach",
  mode: "light",
  surface: OPAQUE,
  tokens: {
    primary: "#96491F",
    onPrimary: "#FFFFFF",
    primaryContainer: "#FFDBCB",
    onPrimaryContainer: "#371100",
    secondary: "#75574C",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#FFDBD1",
    onSecondaryContainer: "#2B160F",
    tertiary: "#6C5D2F",
    tertiaryContainer: "#F5E1A7",
    onTertiaryContainer: "#231B00",
    error: "#BA1A1A",
    onError: "#FFFFFF",
    errorContainer: "#FFDAD6",
    onErrorContainer: "#410002",
    success: "#206C3A",
    onSuccess: "#FFFFFF",
    surface: "#FFF8F6",
    surfaceDim: "#F8E8E5",
    onSurface: "#221A16",
    surfaceVariant: "#F4DED6",
    onSurfaceVariant: "#53433E",
    surfaceContainerLowest: "#FFFFFF",
    surfaceContainerLow: "#FFF1EC",
    surfaceContainer: "#FCEAE4",
    surfaceContainerHigh: "#F6E4DE",
    surfaceContainerHighest: "#F1DED8",
    outline: "#85736D",
    outlineVariant: "#D8C2BB",
    inverseSurface: "#382E2A",
    inverseOnSurface: "#FFEDE7",
    inversePrimary: "#FFB68F",
    scrim: "#000000",
  },
};

// Translucent surfaces over a slow-drifting aurora backdrop.
const AURORA_SURFACE: SurfaceTreatment = { shellAlpha: 0.8, cardAlpha: 0.82, shellBlur: 16, cardBlur: 0, saturate: 1 };

const auroraLight: AppThemeScheme = {
  id: "aurora-light",
  label: "Aurora Light",
  mode: "light",
  surface: AURORA_SURFACE,
  // One blob per color family: warm, cool, green, plus a mixed accent.
  aurora: {
    separator: "#3E3E48",
    glow: false,
    blobs: [
      { x: 0.16, y: 0.2, r: 0.55, colors: ["#FFB454", "#FF7E5F", "#FFD166"], wobble: 0.07, drift: 0.05 },
      { x: 0.84, y: 0.28, r: 0.5, colors: ["#7FA8FF", "#8A7BFF", "#5EC8E8"], wobble: 0.06, drift: 0.042 },
      { x: 0.3, y: 0.8, r: 0.46, colors: ["#57C785", "#9BE8B0", "#2FA872"], wobble: 0.08, drift: 0.06 },
      { x: 0.78, y: 0.82, r: 0.4, colors: ["#FF9AA8", "#FFD166", "#7FB2FF"], wobble: 0.07, drift: 0.048 },
    ],
  },
  tokens: {
    primary: "#6750A4",
    onPrimary: "#FFFFFF",
    primaryContainer: "#E8DEFF",
    onPrimaryContainer: "#21005D",
    secondary: "#625B71",
    onSecondary: "#FFFFFF",
    secondaryContainer: "#E7DEF8",
    onSecondaryContainer: "#1D192B",
    tertiary: "#7D5260",
    tertiaryContainer: "#FFD8E4",
    onTertiaryContainer: "#31111D",
    error: "#B3261E",
    onError: "#FFFFFF",
    errorContainer: "#F9DEDC",
    onErrorContainer: "#410E0B",
    success: "#146C2E",
    onSuccess: "#FFFFFF",
    surface: "#FBFAFF",
    surfaceDim: "#DCD8E8",
    onSurface: "#1B1B21",
    surfaceVariant: "#E5E1F1",
    onSurfaceVariant: "#47464F",
    surfaceContainerLowest: "#FFFFFF",
    surfaceContainerLow: "#F6F4FC",
    surfaceContainer: "#F1EFFA",
    surfaceContainerHigh: "#EAE8F5",
    surfaceContainerHighest: "#E5E3F0",
    outline: "#767680",
    outlineVariant: "#C6C5D0",
    inverseSurface: "#303034",
    inverseOnSurface: "#F4F0FA",
    inversePrimary: "#CFBDFF",
    scrim: "#000000",
  },
};

const auroraDark: AppThemeScheme = {
  id: "aurora-dark",
  label: "Aurora Dark",
  mode: "dark",
  surface: AURORA_SURFACE,
  aurora: {
    separator: "#D9D4EC",
    glow: true,
    blobs: [
      { x: 0.18, y: 0.24, r: 0.55, colors: ["#6A48D7", "#3F8CFF", "#8A7BFF"], wobble: 0.07, drift: 0.05 },
      { x: 0.82, y: 0.3, r: 0.5, colors: ["#B84DFF", "#FF5DA2", "#7A5CFF"], wobble: 0.06, drift: 0.04 },
      { x: 0.34, y: 0.8, r: 0.48, colors: ["#1FC9A8", "#41E0C0", "#2E8BC0"], wobble: 0.08, drift: 0.055 },
      { x: 0.78, y: 0.8, r: 0.4, colors: ["#4F46E5", "#9C6BFF", "#B84DFF"], wobble: 0.07, drift: 0.045 },
    ],
  },
  tokens: {
    primary: "#CFBDFF",
    onPrimary: "#3A1D71",
    primaryContainer: "#4F378B",
    onPrimaryContainer: "#EADDFF",
    secondary: "#C8C3DC",
    onSecondary: "#332D41",
    secondaryContainer: "#4A4458",
    onSecondaryContainer: "#E8DEF8",
    tertiary: "#EFB8C8",
    tertiaryContainer: "#633B48",
    onTertiaryContainer: "#FFD8E4",
    error: "#F2B8B5",
    onError: "#601410",
    errorContainer: "#8C1D18",
    onErrorContainer: "#F9DEDC",
    success: "#6DD58C",
    onSuccess: "#00391B",
    surface: "#131020",
    surfaceDim: "#131020",
    onSurface: "#E5E0F1",
    surfaceVariant: "#48425C",
    onSurfaceVariant: "#C8C3D8",
    surfaceContainerLowest: "#0E0C1A",
    surfaceContainerLow: "#1B1830",
    surfaceContainer: "#1F1D36",
    surfaceContainerHigh: "#2A2744",
    surfaceContainerHighest: "#353150",
    outline: "#918FA6",
    outlineVariant: "#48425C",
    inverseSurface: "#E5E0F1",
    inverseOnSurface: "#302D48",
    inversePrimary: "#6750A4",
    scrim: "#000000",
  },
};

// Liquid glass over a starfield: deep violet-black surfaces, heavy blur,
// a lilac-white neon light raking across the frame edges.
const glass: AppThemeScheme = {
  id: "glass",
  label: "Liquid Glass",
  mode: "dark",
  surface: {
    shellAlpha: 0.62,
    cardAlpha: 0.6,
    shellBlur: 24,
    cardBlur: 18,
    saturate: 1.35,
    neonBorder: "rgba(205,186,255,0.38)",
  },
  tokens: {
    primary: "#CDBDFF",
    onPrimary: "#362268",
    primaryContainer: "#4A3788",
    onPrimaryContainer: "#E8DEFF",
    secondary: "#CBC2DE",
    onSecondary: "#322C41",
    secondaryContainer: "#453E5C",
    onSecondaryContainer: "#E8DEF8",
    tertiary: "#F0B8D0",
    tertiaryContainer: "#633B55",
    onTertiaryContainer: "#FFD8EF",
    error: "#F2B8B5",
    onError: "#601410",
    errorContainer: "#8C1D18",
    onErrorContainer: "#F9DEDC",
    success: "#6DD58C",
    onSuccess: "#00391B",
    surface: "#0E0A1A",
    surfaceDim: "#0E0A1A",
    onSurface: "#E8E3F6",
    surfaceVariant: "#453E5E",
    onSurfaceVariant: "#CBC4E2",
    surfaceContainerLowest: "#080512",
    surfaceContainerLow: "#161028",
    surfaceContainer: "#1B1430",
    surfaceContainerHigh: "#251C3E",
    surfaceContainerHighest: "#30254D",
    outline: "#968FB0",
    outlineVariant: "#453E5E",
    inverseSurface: "#E8E3F6",
    inverseOnSurface: "#342B4C",
    inversePrimary: "#6750A4",
    scrim: "#000000",
  },
};

export const BASE_SCHEMES: AppThemeScheme[] = [dark, light, lightContrast, purple, peach];
export const ADVANCED_SCHEMES: AppThemeScheme[] = [auroraLight, auroraDark, glass];
const BY_ID = new Map(BASE_SCHEMES.concat(ADVANCED_SCHEMES).map((s) => [s.id, s]));

/** Resolves a stored theme id, falling back to Dark on unknown values. */
export function getScheme(id: string): AppThemeScheme {
  return BY_ID.get(id as ThemeId) ?? dark;
}
