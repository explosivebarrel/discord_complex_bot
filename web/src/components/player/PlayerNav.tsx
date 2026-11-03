import { Badge, Box, IconButton, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography } from "@mui/material";
import { IconHistory, IconSearch } from "../icons";
import { MsIcon } from "../MsIcon";

/**
 * The player-local sidebar (the second one, next to the app nav): section
 * switching for the player page with its own persisted collapse state,
 * independent of the global navigation. Collapses to an icon rail.
 */
export type PlayerTab = "search" | "collection" | "history";

export const PLAYER_TABS: { id: PlayerTab; label: string; icon: React.ReactNode }[] = [
  { id: "search", label: "Search", icon: <IconSearch fontSize={22} /> },
  { id: "collection", label: "Collection", icon: <MsIcon name="library_music" fontSize={22} /> },
  { id: "history", label: "History", icon: <IconHistory fontSize={22} /> },
];

export function PlayerNav({
  tab,
  onTab,
  collapsed,
  onToggle,
  queueLength,
}: {
  tab: PlayerTab;
  onTab: (t: PlayerTab) => void;
  collapsed: boolean;
  onToggle: () => void;
  queueLength: number;
}) {
  return (
    <Box
      sx={{
        width: collapsed ? 64 : 200,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        transition: (tt) => tt.transitions.create("width", { duration: tt.transitions.duration.standard }),
      }}
    >
      {/* Header row: the collapse toggle doubles as it on the rail. */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", px: collapsed ? 0 : 1.5, pt: 1, minHeight: 48 }}>
        {!collapsed && (
          <Typography variant="overline" sx={{ color: "text.secondary", pl: 1 }}>
            Player
          </Typography>
        )}
        <Tooltip title={collapsed ? "Expand player menu" : "Collapse player menu"}>
          <IconButton onClick={onToggle} aria-label={collapsed ? "Expand player menu" : "Collapse player menu"} size="small">
            <MsIcon name={collapsed ? "left_panel_open" : "left_panel_close"} fill={false} fontSize={22} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box component="nav" sx={{ flex: 1, overflowY: "auto", pt: 0.5 }}>
        {PLAYER_TABS.map((t) => (
          <Tooltip key={t.id} title={collapsed ? t.label : undefined} placement="right" disableInteractive>
            <ListItemButton
              selected={tab === t.id}
              onClick={() => onTab(t.id)}
              sx={{
                borderRadius: collapsed ? "50%" : 999,
                mb: 0.5,
                justifyContent: collapsed ? "center" : "flex-start",
                ...(collapsed
                  ? { width: 48, height: 48, minHeight: 48, px: 0, mx: "auto" }
                  : { minHeight: 44, px: 2, mx: 1.25 }),
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: "center" }}>
                {t.id === "history" ? (
                  <Badge badgeContent={queueLength} color="primary">
                    {t.icon}
                  </Badge>
                ) : (
                  t.icon
                )}
              </ListItemIcon>
              {!collapsed && (
                <ListItemText primary={t.label} slotProps={{ primary: { noWrap: true, variant: "body1" } }} />
              )}
            </ListItemButton>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}
