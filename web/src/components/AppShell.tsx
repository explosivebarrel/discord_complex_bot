import { type ReactNode, useEffect, useState } from "react";
import { AppBar, Avatar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { Link as RouterLink, matchPath, useLocation } from "react-router-dom";
import ArrowBack from "@mui/icons-material/ArrowBack";
import BarChart from "@mui/icons-material/BarChart";
import Forum from "@mui/icons-material/Forum";
import Gavel from "@mui/icons-material/Gavel";
import GraphicEq from "@mui/icons-material/GraphicEq";
import PlayCircle from "@mui/icons-material/PlayCircle";
import Settings from "@mui/icons-material/Settings";
import Logout from "@mui/icons-material/Logout";
import MenuRounded from "@mui/icons-material/Menu";
import type { GuildBrief, Me } from "../api";
import { api } from "../api";
import { useBotName } from "../useMeta";

export const DRAWER_WIDTH = 264;

function guildIconUrl(guild: GuildBrief) {
  if (!guild.icon) return undefined;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`;
}

/** One navigation destination inside the drawer (MD3 pill item). */
function NavItem({
  to,
  icon,
  label,
  selected,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <ListItemButton
      component={RouterLink}
      to={to}
      selected={selected}
      onClick={onClick}
      sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2 }}
    >
      <ListItemIcon sx={{ minWidth: 40 }}>{icon}</ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { noWrap: true, variant: "body1" } }} />
    </ListItemButton>
  );
}

function DrawerContent({
  me,
  guilds,
  activeGuildId,
  onNavigate,
  onLogout,
}: {
  me: Me | null;
  guilds: GuildBrief[];
  activeGuildId: string | null;
  onNavigate?: () => void;
  onLogout?: () => void;
}) {
  const botName = useBotName();
  const active = guilds.find((g) => g.id === activeGuildId) ?? null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ gap: 1.5, px: 2.5 }}>
        <GraphicEq sx={{ color: "primary.main" }} />
        <Typography variant="h6" noWrap sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {botName}
        </Typography>
      </Toolbar>
      <Divider />
      <List component="nav" sx={{ flex: 1, overflowY: "auto", pt: 1.5 }} disablePadding>
        <Typography variant="overline" sx={{ px: 2.75, color: "text.secondary" }}>
          Servers
        </Typography>
        {guilds.map((g) => (
          <ListItemButton
            key={g.id}
            component={RouterLink}
            to={`/guild/${g.id}`}
            selected={g.id === activeGuildId}
            onClick={onNavigate}
            sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Avatar src={guildIconUrl(g)} sx={{ width: 26, height: 26, fontSize: 13 }}>
                {g.name.slice(0, 1)}
              </Avatar>
            </ListItemIcon>
            <ListItemText primary={g.name} slotProps={{ primary: { noWrap: true, variant: "body1" } }} />
          </ListItemButton>
        ))}
        {active && (
          <>
            <Typography variant="overline" sx={{ px: 2.75, pt: 1.5, color: "text.secondary", display: "block" }}>
              {active.name}
            </Typography>
            <NavItem
              to={`/guild/${active.id}`}
              icon={<PlayCircle fontSize="small" />}
              label="Player"
              selected
              onClick={onNavigate}
            />
            {active.access.stats && (
              <NavItem
                to={`/guild/${active.id}/stats`}
                icon={<BarChart fontSize="small" />}
                label="Stats"
                onClick={onNavigate}
              />
            )}
            {active.access.posts && (
              <NavItem
                to={`/guild/${active.id}/posts`}
                icon={<Forum fontSize="small" />}
                label="Posts"
                onClick={onNavigate}
              />
            )}
            {active.access.moderation && (
              <NavItem
                to={`/guild/${active.id}/moderation`}
                icon={<Gavel fontSize="small" />}
                label="Moderation"
                onClick={onNavigate}
              />
            )}
          </>
        )}
      </List>
      <Divider />
      <List component="nav" disablePadding sx={{ py: 1 }}>
        {me?.is_superadmin && (
          <NavItem to="/settings" icon={<Settings fontSize="small" />} label="Settings" onClick={onNavigate} />
        )}
        {me && onLogout && (
          <ListItemButton onClick={onLogout} sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Avatar src={me.avatar_url} sx={{ width: 26, height: 26, fontSize: 13 }} />
            </ListItemIcon>
            <ListItemText
              primary={me.global_name}
              secondary="Logout"
              slotProps={{ primary: { noWrap: true, variant: "body1" }, secondary: { variant: "caption" } }}
            />
            <Logout fontSize="small" sx={{ color: "text.secondary", mr: 1 }} />
          </ListItemButton>
        )}
        {me && !onLogout && (
          <Box sx={{ px: 3, py: 1, display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
            <Avatar src={me.avatar_url} sx={{ width: 26, height: 26, fontSize: 13 }} />
            <Typography variant="body1" noWrap>
              {me.global_name}
            </Typography>
          </Box>
        )}
      </List>
    </Box>
  );
}

export function AppShell({
  me,
  title,
  back,
  onLogout,
  right,
  children,
}: {
  me: Me | null;
  title?: string;
  /** Show a back arrow that leads to the home page. */
  back?: boolean;
  onLogout?: () => void;
  /** Optional second (right) column: the queue sidebar on wide screens. */
  right?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [guilds, setGuilds] = useState<GuildBrief[]>([]);
  const location = useLocation();
  const subMatch = matchPath("/guild/:guildId/*", location.pathname);
  const exactMatch = matchPath("/guild/:guildId", location.pathname);
  const activeGuildId = subMatch?.params.guildId ?? exactMatch?.params.guildId ?? null;

  useEffect(() => {
    if (!me) return;
    api
      .myGuilds()
      .then(setGuilds)
      .catch(() => setGuilds([]));
  }, [me]);

  const drawerPaperSx = {
    width: DRAWER_WIDTH,
    boxSizing: "border-box" as const,
    bgcolor: "#211F26",
  };

  return (
    <Box sx={{ minHeight: "100dvh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          bgcolor: "#211F26",
          borderBottom: "1px solid #2B2930",
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
        }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          {!isWide && me && (
            <IconButton size="small" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
              <MenuRounded />
            </IconButton>
          )}
          {back && (
            <Tooltip title="Back to servers">
              <IconButton component={RouterLink} to="/" size="small">
                <ArrowBack />
              </IconButton>
            </Tooltip>
          )}
          <Typography
            variant="h6"
            noWrap
            sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {title ?? ""}
          </Typography>
          {me?.is_superadmin && !isWide && (
            <Tooltip title="System settings">
              <IconButton component={RouterLink} to="/settings" size="small">
                <Settings />
              </IconButton>
            </Tooltip>
          )}
          {me && !isWide && <Avatar src={me.avatar_url} sx={{ width: 30, height: 30 }} />}
        </Toolbar>
      </AppBar>

      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": drawerPaperSx }}
      >
        <DrawerContent
          me={me}
          guilds={guilds}
          activeGuildId={activeGuildId}
          onNavigate={() => setDrawerOpen(false)}
          onLogout={onLogout}
        />
      </Drawer>

      {/* Main area next to the drawer. */}
      <Box sx={{ display: { md: "flex" } }}>
        {isWide && (
          <Drawer
            variant="permanent"
            sx={{
              width: DRAWER_WIDTH,
              flexShrink: 0,
              "& .MuiDrawer-paper": { ...drawerPaperSx, borderRight: "1px solid #2B2930" },
            }}
          >
            <DrawerContent me={me} guilds={guilds} activeGuildId={activeGuildId} onLogout={onLogout} />
          </Drawer>
        )}
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            width: "100%",
            maxWidth: right ? 1560 : 1100,
            mx: "auto",
            px: { xs: 1.5, sm: 3 },
          }}
        >
          <Box
            sx={{
              display: { lg: right ? "flex" : "block" } as const,
              gap: 3,
              alignItems: "flex-start",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, pt: { xs: 10, sm: 11 }, pb: right ? { xs: 22, sm: 18 } : 4 }}>
              {children}
            </Box>
            {right && (
              <Box
                sx={{
                  width: { lg: 340 },
                  flexShrink: 0,
                  pt: { xs: 2, sm: 11 },
                  pb: { xs: 22, sm: 18 },
                }}
              >
                {right}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
