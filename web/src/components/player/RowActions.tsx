import { Box } from "@mui/material";

/** Frosted capsule behind a row's action cluster: one shared blurred,
    dissolving backdrop instead of per-button fills, with fully rounded
    (half-circle) ends. The cluster is hover-only where the row opts in:
    hidden until the row is hovered, always visible on touch. */
export function RowActions({ children }: { children: React.ReactNode }) {
  return (
    <Box
      className="row-actions"
      sx={(t) => ({
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        borderRadius: 999,
        px: 0.5,
        py: "3px",
        backdropFilter: "blur(14px) saturate(1.4)",
        bgcolor:
          t.palette.mode === "dark"
            ? "rgba(18,14,28,.55)"
            : "rgba(255,255,255,.55)",
        boxShadow: `inset 0 0 0 1px ${t.palette.divider}`,
      })}
    >
      {children}
    </Box>
  );
}

/** Row-side sx that goes with <RowActions>: the capsule is inset to match
    the row's left padding and revealed on hover only. */
export const rowActionsRowSx = {
  "& .MuiListItemSecondaryAction-root": { right: 12 },
  "& .row-actions": { visibility: "hidden" },
  "&:hover .row-actions": { visibility: "visible" },
  ["@media (hover: none)"]: { "& .row-actions": { visibility: "visible" } },
} as const;
