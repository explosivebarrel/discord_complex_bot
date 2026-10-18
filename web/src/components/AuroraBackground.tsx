import { Box } from "@mui/material";
import { useAppTheme } from "../themes/AppThemeContext";

// Base position of each blob; the keyframes below only translate/scale, so
// the whole animation stays compositor-side (GPU) and cheap.
const BLOBS = [
  { top: "-18%", left: "-12%", keyframes: { from: { transform: "translate3d(0,0,0) scale(1)" }, to: { transform: "translate3d(16vw,12vh,0) scale(1.25)" } }, duration: "34s" },
  { top: "38%", left: "52%", keyframes: { from: { transform: "translate3d(0,0,0) scale(1.1)" }, to: { transform: "translate3d(-14vw,-10vh,0) scale(0.9)" } }, duration: "42s" },
  { top: "52%", left: "-16%", keyframes: { from: { transform: "translate3d(0,0,0) scale(0.95)" }, to: { transform: "translate3d(12vw,-14vh,0) scale(1.2)" } }, duration: "50s" },
  { top: "-22%", left: "42%", keyframes: { from: { transform: "translate3d(0,0,0) scale(1.05)" }, to: { transform: "translate3d(-10vw,14vh,0) scale(0.85)" } }, duration: "38s" },
];

/**
 * Fixed backdrop of the aurora themes: four large soft radial blobs slowly
 * drifting behind the translucent app frame. Respects the system
 * "reduce motion" setting by rendering a still composition.
 */
export function AuroraBackground() {
  const { scheme } = useAppTheme();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        bgcolor: "background.default",
        pointerEvents: "none",
      }}
    >
      {(scheme.aurora ?? []).map((color, i) => {
        const blob = BLOBS[i % BLOBS.length];
        return (
          <Box
            key={i}
            sx={{
              position: "absolute",
              width: "55vmax",
              height: "55vmax",
              top: blob.top,
              left: blob.left,
              borderRadius: "50%",
              background: `radial-gradient(closest-side, ${color}, transparent 72%)`,
              opacity: 0.5,
              [`@keyframes aurora-drift-${i}`]: blob.keyframes,
              ...(reduced
                ? {}
                : { animation: `aurora-drift-${i} ${blob.duration} ease-in-out infinite alternate` }),
            }}
          />
        );
      })}
    </Box>
  );
}
