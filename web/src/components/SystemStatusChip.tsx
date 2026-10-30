import { Box, ListItemButton, ListItemIcon, Tooltip } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useSystemStatus } from "../queries";
import { useStatusPalette } from "./statusColors";

const AVAILABILITY_LINK = "/about?tab=availability";

/** Drawer footer chip over the latest availability pass: a quiet green dot
    when everything is up, yellow/red with a label when a dependency is
    degraded (slow, or a source is unavailable) or the bot is offline.
    Links straight to the Availability tab of the About page. The dot sits
    in a 40px icon slot so it aligns with the icons of the rows above. */
export function SystemStatusChip({ collapsed }: { collapsed: boolean }) {
  const { data } = useSystemStatus();
  if (!data) return null;
  const statuses = data.statuses ?? {};
  const down = statuses.discord_gateway === 0 || statuses.lavalink === 0;
  const degraded = !down && Object.values(statuses).some((v) => v === 1 || v === 0);
  const pal = useStatusPalette();
  const color = down ? pal.down : degraded ? pal.degraded : pal.up;
  const label = down ? "Bot offline" : degraded ? "Degraded" : "All systems operational";
  const dot = (
    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color }} />
  );
  if (collapsed) {
    // Same 48px round shape as the other collapsed rail buttons.
    return (
      <Tooltip title={label} placement="right">
        <ListItemButton
          component={RouterLink}
          to={AVAILABILITY_LINK}
          sx={{
            width: 48,
            height: 48,
            minHeight: 48,
            px: 0,
            mx: "auto",
            mb: 0.5,
            borderRadius: "50%",
            justifyContent: "center",
          }}
        >
          <ListItemIcon sx={{ minWidth: 0, justifyContent: "center" }}>{dot}</ListItemIcon>
        </ListItemButton>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={label}>
      <ListItemButton
        component={RouterLink}
        to={AVAILABILITY_LINK}
        sx={{ minHeight: 44, px: 2, mx: 1.25, mb: 0.5, borderRadius: 999 }}
      >
        {/* The 40px icon slot keeps the dot aligned with every other icon. */}
        <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>{dot}</ListItemIcon>
        <Box
          component="span"
          sx={{ fontSize: 13, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {label}
        </Box>
      </ListItemButton>
    </Tooltip>
  );
}
