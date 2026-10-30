import { Box, IconButton, ListItemButton, ListItemText, Tooltip } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useSystemStatus } from "../queries";

/** Drawer footer chip over the latest availability pass: a quiet green dot
    when everything is up, yellow/red with a label when a dependency is
    degraded (slow, or a source is unavailable) or the bot is offline.
    Links to the About page where the full availability picture lives. */
export function SystemStatusChip({ collapsed }: { collapsed: boolean }) {
  const { data } = useSystemStatus();
  if (!data) return null;
  const statuses = data.statuses ?? {};
  const down = statuses.discord_gateway === 0 || statuses.lavalink === 0;
  const degraded = !down && Object.values(statuses).some((v) => v === 1 || v === 0);
  const color = down ? "error.main" : degraded ? "warning.main" : "success.main";
  const label = down ? "Bot offline" : degraded ? "Degraded" : "All systems operational";
  const dot = (
    <Box
      sx={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        bgcolor: color,
        flexShrink: 0,
      }}
    />
  );
  if (collapsed) {
    return (
      <Tooltip title={label} placement="right">
        <IconButton component={RouterLink} to="/about" sx={{ mx: "auto", display: "flex", mb: 0.5 }}>
          {dot}
        </IconButton>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={label}>
      <ListItemButton
        component={RouterLink}
        to="/about"
        sx={{ mx: 1.25, mb: 0.5, minHeight: 36, borderRadius: 999, gap: 1.25 }}
      >
        {dot}
        <ListItemText
          primary={label}
          slotProps={{ primary: { noWrap: true, variant: "body2", sx: { color: "text.secondary" } } }}
        />
      </ListItemButton>
    </Tooltip>
  );
}
