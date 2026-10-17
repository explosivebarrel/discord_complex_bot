import { type ReactNode, useEffect, useState } from "react";
import { AppBar, Avatar, Badge, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { Link as RouterLink, matchPath, useLocation } from "react-router-dom";
import ArrowBack from "@mui/icons-material/ArrowBack";
import BarChart from "@mui/icons-material/BarChart";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import Forum from "@mui/icons-material/Forum";
import Gavel from "@mui/icons-material/Gavel";
import GraphicEq from "@mui/icons-material/GraphicEq";
import PlayCircle from "@mui/icons-material/PlayCircle";
import QueueMusic from "@mui/icons-material/QueueMusic";
import Settings from "@mui/icons-material/Settings";
import Logout from "@mui/icons-material/Logout";
import MenuRounded from "@mui/icons-material/Menu";
import ViewSidebar from "@mui/icons-material/ViewSidebar";
import type { GuildBrief, Me } from "../api";
import { api } from "../api";
import { useBotName } from "../useMeta";
import { useLocalPref } from "../useLocalPref";

export const DRAWER_WIDTH = 264;
export const DRAWER_RAIL_WIDTH = 80;

function guildIconUrl(guild: GuildBrief) {
  if (!guild.icon) return undefined;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`;
}

/** Section tab of the current guild: exact route match decides selection. */
function GuildTab({
  to,
  icon,
  label,
  collapsed,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <Tooltip title={collapsed ? label : undefined} placement="right" disableInteractive>
      <ListItemButton
        component={RouterLink}
        to={to}
        selected={pathname === to}
        onClick={onClick}
        sx={{
          borderRadius: 999,
          mx: 1.25,
          mb: 0.5,
          minHeight: 44,
          justifyContent: collapsed ? "center" : "flex-start",
          px: collapsed ? 0 : 2,
        }}
      >
        <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: "center" }}>{icon}</ListItemIcon>
        {!collapsed && <ListItemText primary={label} slotProps={{ primary: { noWrap: true, variant: "body1" } }} />}
      </ListItemButton>
    </Tooltip>
  );
}

function DrawerContent({
  me,
  guilds,
  activeGuildId,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onLogout,
}: {
  me: Me | null;
  guilds: GuildBrief[];
  activeGuildId: string | null;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  onLogout?: () => void;
}) {
  const botName = useBotName();
  // Every page gets logout through the drawer; a page may override it.
  const doLogout = onLogout ?? (() => api.logout().then(() => window.location.reload()));
  const active = guilds.find((g) => g.id === activeGuildId) ?? null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar sx={{ gap: 1.5, px: collapsed ? 1 : 2.5, justifyContent: collapsed ? "center" : "flex-start" }}>
        {collapsed ? (
          <IconButton onClick={onToggleCollapse} size="small" aria-label="Expand navigation">
            <GraphicEq sx={{ color: "primary.main" }} />
          </IconButton>
        ) : (
          <>
            <GraphicEq sx={{ color: "primary.main" }} />
            <Typography
              variant="subtitle2"
              noWrap
              title={botName}
              sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {botName}
            </Typography>
            {onToggleCollapse && (
              <Tooltip title="Collapse menu">
                <IconButton onClick={onToggleCollapse} size="small" aria-label="Collapse menu">
                  <ChevronLeft />
                </IconButton>
              </Tooltip>
            )}
          </>
        )}
      </Toolbar>
      <Divider />
      <List component="nav" sx={{ flex: 1, overflowY: "auto", pt: 1.5 }} disablePadding>
        {active && (
          <>
            {!collapsed && (
              <Typography variant="overline" sx={{ px: 2.75, color: "text.secondary" }}>
                {active.name}
              </Typography>
            )}
            <GuildTab
              to={`/guild/${active.id}`}
              icon={<PlayCircle fontSize="small" />}
              label="Player"
              collapsed={collapsed}
              onClick={onNavigate}
            />
            {active.access.stats && (
              <GuildTab
                to={`/guild/${active.id}/stats`}
                icon={<BarChart fontSize="small" />}
                label="Stats"
                collapsed={collapsed}
                onClick={onNavigate}
              />
            )}
            {active.access.posts && (
              <GuildTab
                to={`/guild/${active.id}/posts`}
                icon={<Forum fontSize="small" />}
                label="Posts"
                collapsed={collapsed}
                onClick={onNavigate}
              />
            )}
            {active.access.moderation && (
              <GuildTab
                to={`/guild/${active.id}/moderation`}
                icon={<Gavel fontSize="small" />}
                label="Moderation"
                collapsed={collapsed}
                onClick={onNavigate}
              />
            )}
            <Divider sx={{ mx: 2, my: 1.5 }} />
          </>
        )}
        {!collapsed && (
          <Typography variant="overline" sx={{ px: 2.75, color: "text.secondary" }}>
            Servers
          </Typography>
        )}
        {guilds.map((g) => (
          <Tooltip key={g.id} title={collapsed ? g.name : undefined} placement="right" disableInteractive>
            <ListItemButton
              component={RouterLink}
              to={`/guild/${g.id}`}
              selected={g.id === activeGuildId}
              onClick={onNavigate}
              sx={{
                borderRadius: 999,
                mx: collapsed ? "auto" : 1.25,
                mb: 0.5,
                width: collapsed ? 48 : undefined,
                px: collapsed ? 0 : 2,
                minHeight: 44,
                justifyContent: "center",
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: "center" }}>
                <Avatar src={guildIconUrl(g)} sx={{ width: 26, height: 26, fontSize: 13 }}>
                  {g.name.slice(0, 1)}
                </Avatar>
              </ListItemIcon>
              {!collapsed && <ListItemText primary={g.name} slotProps={{ primary: { noWrap: true, variant: "body1" } }} />}
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
      <Divider />
      <List component="nav" disablePadding sx={{ py: 1 }}>
        {me?.is_superadmin && (
          <GuildTab to="/settings" icon={<Settings fontSize="small" />} label="Settings" collapsed={collapsed} onClick={onNavigate} />
        )}
        {me && !collapsed && (
          <ListItemButton onClick={doLogout} sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2, minHeight: 44 }}>
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
        {me && collapsed && (
          <Tooltip title={`${me.global_name} — logout`} placement="right" disableInteractive>
            <IconButton
              onClick={doLogout}
              sx={{ mx: "auto", display: "flex", mb: 0.5 }}
              aria-label="Account"
            >
              <Avatar src={me.avatar_url} sx={{ width: 30, height: 30, fontSize: 13 }} />
            </IconButton>
          </Tooltip>
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
  rightBadge,
  children,
}: {
  me: Me | null;
  title?: string;
  /** Show a back arrow that leads to the home page. */
  back?: boolean;
  onLogout?: () => void;
  /** Optional second (right) column: the player sidebar on wide screens. */
  right?: ReactNode;
  /** Badge number for the collapsed right rail (queue length). */
  rightBadge?: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  const [navCollapsed, setNavCollapsed] = useLocalPref("ui.navCollapsed", false);
  const [rightOpen, setRightOpen] = useLocalPref("ui.rightOpen", true);
  const [modalOpen, setModalOpen] = useState(false);
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

  const navWidth = navCollapsed ? DRAWER_RAIL_WIDTH : DRAWER_WIDTH;
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
          width: { md: `calc(100% - ${navWidth}px)` },
          ml: { md: `${navWidth}px` },
        }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          {!isWide && me && (
            <IconButton size="small" onClick={() => setModalOpen(true)} aria-label="Open navigation">
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
          {right && (
            <Tooltip title={rightOpen ? "Hide player sidebar" : "Show player sidebar"}>
              <IconButton size="small" onClick={() => setRightOpen(!rightOpen)} aria-label="Toggle player sidebar">
                {rightOpen ? <ChevronRight /> : <ViewSidebar />}
              </IconButton>
            </Tooltip>
          )}
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": drawerPaperSx }}
      >
        <DrawerContent
          me={me}
          guilds={guilds}
          activeGuildId={activeGuildId}
          collapsed={false}
          onNavigate={() => setModalOpen(false)}
          onLogout={onLogout}
        />
      </Drawer>

      {/* Main area next to the drawer. */}
      <Box sx={{ display: { md: "flex" } }}>
        {isWide && (
          <Drawer
            variant="permanent"
            sx={{
              width: navWidth,
              flexShrink: 0,
              transition: theme.transitions.create("width", { duration: theme.transitions.duration.standard }),
              "& .MuiDrawer-paper": {
                ...drawerPaperSx,
                width: navWidth,
                borderRight: "1px solid #2B2930",
                transition: theme.transitions.create("width", { duration: theme.transitions.duration.standard }),
                overflowX: "hidden",
              },
            }}
          >
            <DrawerContent
              me={me}
              guilds={guilds}
              activeGuildId={activeGuildId}
              collapsed={navCollapsed}
              onToggleCollapse={() => setNavCollapsed(!navCollapsed)}
              onLogout={onLogout}
            />
          </Drawer>
        )}
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            width: "100%",
            maxWidth: right && rightOpen ? 1560 : 1100,
            mx: "auto",
            px: { xs: 1.5, sm: 3 },
          }}
        >
          <Box
            sx={{
              display: { lg: right && rightOpen ? "flex" : "block" } as const,
              gap: 3,
              alignItems: "flex-start",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, pt: { xs: 10, sm: 11 }, pb: right && rightOpen ? { xs: 22, sm: 18 } : 4 }}>
              {children}
            </Box>
            {right && !rightOpen && (
              <Box sx={{ display: { xs: "none", lg: "flex" }, flexDirection: "column", alignItems: "center", gap: 1, pt: { sm: 11 }, width: 56, flexShrink: 0 }}>
                <Tooltip title="Show player sidebar">
                  <IconButton onClick={() => setRightOpen(true)} aria-label="Show player sidebar">
                    <ChevronLeft />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Queue">
                  <IconButton onClick={() => setRightOpen(true)} aria-label="Show queue">
                    <Badge badgeContent={rightBadge ?? 0} color="primary">
                      <QueueMusic />
                    </Badge>
                  </IconButton>
                </Tooltip>
              </Box>
            )}
            {right && rightOpen && (
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
