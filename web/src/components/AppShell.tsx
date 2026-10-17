import { type ReactNode, useCallback, useState } from "react";
import { Avatar, Badge, Box, Divider, Drawer, IconButton, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Stack, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { Link as RouterLink, matchPath, useLocation } from "react-router-dom";
import { IconGraphicEq } from "./icons";
import { MsIcon } from "./MsIcon";
import type { GuildBrief, Me } from "../api";
import { api } from "../api";
import { useGuilds } from "../queries";
import { useBotName } from "../useMeta";
import { useLocalPref } from "../useLocalPref";
import { m3 } from "../theme";

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
          borderRadius: collapsed ? "50%" : 999,
          mb: 0.5,
          justifyContent: collapsed ? "center" : "flex-start",
          // Collapsed rail: circular highlight; expanded: capsule.
          ...(collapsed
            ? { width: 48, height: 48, minHeight: 48, px: 0, mx: "auto" }
            : { minHeight: 44, px: 2, mx: 1.25 }),
        }}
      >
        <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: "center" }}>{icon}</ListItemIcon>
        {!collapsed && <ListItemText primary={label} slotProps={{ primary: { noWrap: true, variant: "body1" } }} />}
      </ListItemButton>
    </Tooltip>
  );
}

// Shared Material Symbols glyphs of the shell (https://fonts.google.com/icons).
// The panel toggles are outlined: filled they read too heavy.
const Ic = {
  player: <MsIcon name="play_circle" />,
  stats: <MsIcon name="bar_chart" />,
  posts: <MsIcon name="forum" />,
  moderation: <MsIcon name="gavel" />,
  settings: <MsIcon name="settings" />,
  logout: <MsIcon name="logout" />,
  menu: <MsIcon name="menu" />,
  back: <MsIcon name="arrow_back" />,
  leftClose: <MsIcon name="left_panel_close" fill={false} />,
  leftOpen: <MsIcon name="left_panel_open" fill={false} />,
  rightClose: <MsIcon name="right_panel_close" fill={false} />,
  rightOpen: <MsIcon name="right_panel_open" fill={false} />,
  queue: <MsIcon name="queue_music" />,
};

function DrawerContent({
  me,
  guilds,
  guildsLoading,
  activeGuildId,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onLogout,
}: {
  me: Me | null;
  guilds: GuildBrief[];
  guildsLoading: boolean;
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
          <IconButton onClick={onToggleCollapse} aria-label="Expand navigation">
            {Ic.leftOpen}
          </IconButton>
        ) : (
          <>
            <IconGraphicEq sx={{ color: "primary.main" }} />
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
                <IconButton onClick={onToggleCollapse} aria-label="Collapse menu">
                  {Ic.leftClose}
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
            <GuildTab
              to={`/guild/${active.id}`}
              icon={Ic.player}
              label="Player"
              collapsed={collapsed}
              onClick={onNavigate}
            />
            {active.access.stats && (
              <GuildTab
                to={`/guild/${active.id}/stats`}
                icon={Ic.stats}
                label="Stats"
                collapsed={collapsed}
                onClick={onNavigate}
              />
            )}
            {active.access.posts && (
              <GuildTab
                to={`/guild/${active.id}/posts`}
                icon={Ic.posts}
                label="Posts"
                collapsed={collapsed}
                onClick={onNavigate}
              />
            )}
            {active.access.moderation && (
              <GuildTab
                to={`/guild/${active.id}/moderation`}
                icon={Ic.moderation}
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
        {guildsLoading && <LinearProgress sx={{ mx: 2, my: 1, borderRadius: 999 }} />}
        {guilds.map((g) => (
          <Tooltip key={g.id} title={collapsed ? g.name : undefined} placement="right" disableInteractive>
            <ListItemButton
              component={RouterLink}
              to={`/guild/${g.id}`}
              selected={g.id === activeGuildId}
              onClick={onNavigate}
              sx={{
                borderRadius: collapsed ? "50%" : 999,
                mb: 0.5,
                justifyContent: "center",
                // Collapsed rail: circular highlight; expanded: capsule.
                ...(collapsed
                  ? { width: 48, height: 48, minHeight: 48, px: 0, mx: "auto" }
                  : { minHeight: 44, px: 2, mx: 1.25 }),
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
          <GuildTab to="/settings" icon={Ic.settings} label="Settings" collapsed={collapsed} onClick={onNavigate} />
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
            <Box sx={{ color: "text.secondary", mr: 1, display: "flex" }}>{Ic.logout}</Box>
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

/**
 * Inset-surface app frame (MD3): the whole app is one rounded card inset in
 * the viewport by 16px. Nothing floats or sticks — nav, content column and
 * the player sheet are flex children of the frame, and only the content
 * column and the queue list scroll inside it.
 */
export function AppShell({
  me,
  title,
  back,
  onLogout,
  right,
  rightBadge,
  dock,
  children,
}: {
  me: Me | null;
  title?: string;
  /** Show a back arrow that leads to the home page. */
  back?: boolean;
  onLogout?: () => void;
  /** Optional right column: the player queue sheet on wide screens. */
  right?: ReactNode;
  /** Badge number for the collapsed right rail (queue length). */
  rightBadge?: number;
  /** Bottom dock of the content column (the player dock on the player page). */
  dock?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up("md"));
  // lg and up: the player sidebar is a pinned column of the frame; below lg
  // it is a modal drawer so it never squeezes the page content.
  const isLarge = useMediaQuery(theme.breakpoints.up("lg"));
  const [navCollapsed, setNavCollapsed] = useLocalPref("ui.navCollapsed", false);
  const [sheetOpen, setSheetOpen] = useLocalPref("ui.rightOpen", true);
  // On wide screens the sheet open/closed state persists; below lg the
  // modal drawer is ephemeral so it does not pop up on every navigation.
  const [modalRightOpen, setModalRightOpen] = useState(false);
  const rightOpen = isLarge ? sheetOpen : modalRightOpen;
  const setRightOpen = useCallback(
    (v: boolean) => {
      if (isLarge) setSheetOpen(v);
      else setModalRightOpen(v);
    },
    [isLarge, setSheetOpen],
  );
  const [modalOpen, setModalOpen] = useState(false);
  // Shared cache with GuildsPage: the drawer renders instantly on revisit.
  const guildsQuery = useGuilds();
  const guilds = guildsQuery.data ?? [];
  const guildsLoading = !!me && guildsQuery.isPending;
  const location = useLocation();
  const subMatch = matchPath("/guild/:guildId/*", location.pathname);
  const exactMatch = matchPath("/guild/:guildId", location.pathname);
  const activeGuildId = subMatch?.params.guildId ?? exactMatch?.params.guildId ?? null;

  const navWidth = navCollapsed ? DRAWER_RAIL_WIDTH : DRAWER_WIDTH;
  const navPaperSx = {
    width: DRAWER_WIDTH,
    boxSizing: "border-box" as const,
    bgcolor: m3.surface,
  };

  return (
    <Box
      sx={{
        height: "100dvh",
        p: 2,
        boxSizing: "border-box",
        bgcolor: m3.surfaceContainerLowest,
        overflow: "hidden",
      }}
    >
      {/* Temporary drawers (small screens): navigation and the player queue. */}
      <Drawer
        variant="temporary"
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: "block", md: "none" }, "& .MuiDrawer-paper": navPaperSx }}
      >
        <DrawerContent
          me={me}
          guilds={guilds}
          guildsLoading={guildsLoading}
          activeGuildId={activeGuildId}
          collapsed={false}
          onNavigate={() => setModalOpen(false)}
          onLogout={onLogout}
        />
      </Drawer>

      {right && !isLarge && (
        <Drawer
          variant="temporary"
          anchor="right"
          open={rightOpen}
          onClose={() => setRightOpen(false)}
          sx={{
            display: { lg: "none" },
            "& .MuiDrawer-paper": {
              bgcolor: m3.surface,
              width: 360,
              maxWidth: "88vw",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              p: 2,
            },
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1.5, flexShrink: 0 }}>
            <Typography variant="overline" sx={{ color: "text.secondary", flex: 1 }}>
              Player
            </Typography>
            <Tooltip title="Hide player sidebar">
              <IconButton onClick={() => setRightOpen(false)} aria-label="Hide player sidebar">
                {Ic.rightClose}
              </IconButton>
            </Tooltip>
          </Stack>
          {right}
        </Drawer>
      )}

      {/* The inset frame: nav | content | player sheet. */}
      <Box
        sx={{
          height: "100%",
          bgcolor: m3.surface,
          borderRadius: "24px",
          overflow: "hidden",
          display: "flex",
        }}
      >
        {isWide && (
          <Box
            sx={{
              width: navWidth,
              flexShrink: 0,
              overflow: "hidden",
              borderRight: `1px solid ${m3.outlineVariant}`,
              transition: theme.transitions.create("width", { duration: theme.transitions.duration.standard }),
            }}
          >
            <DrawerContent
              me={me}
              guilds={guilds}
              guildsLoading={guildsLoading}
              activeGuildId={activeGuildId}
              collapsed={navCollapsed}
              onToggleCollapse={() => setNavCollapsed(!navCollapsed)}
              onLogout={onLogout}
            />
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Page header: typography on the frame surface, no bar panel.
              Shares the centered content width so the title lines up with
              the page column on wide screens. */}
          <Box sx={{ px: 3, pt: 2, pb: 1.5, flexShrink: 0 }}>
            <Box sx={{ maxWidth: 1400, mx: "auto", display: "flex", alignItems: "center", gap: 1 }}>
            {!isWide && me && (
              <IconButton onClick={() => setModalOpen(true)} aria-label="Open navigation">
                {Ic.menu}
              </IconButton>
            )}
            {back && (
              <Tooltip title="Back to servers">
                <IconButton component={RouterLink} to="/">
                  {Ic.back}
                </IconButton>
              </Tooltip>
            )}
            <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {title ?? ""}
            </Typography>
            {/* Below lg the queue lives in a modal drawer, so the header
                carries its restore button; on lg+ the rail does that. */}
            {right && !rightOpen && !isLarge && (
              <Tooltip title="Show player sidebar">
                <IconButton onClick={() => setRightOpen(true)} aria-label="Show player sidebar">
                  {Ic.rightOpen}
                </IconButton>
              </Tooltip>
            )}
            {me?.is_superadmin && !isWide && (
              <Tooltip title="System settings">
                <IconButton component={RouterLink} to="/settings">
                  {Ic.settings}
                </IconButton>
              </Tooltip>
            )}
            {me && !isWide && <Avatar src={me.avatar_url} sx={{ width: 30, height: 30 }} />}
            </Box>
          </Box>

          {/* The only page-level scroll container. */}
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 3, pb: 3 }}>
            <Box sx={{ maxWidth: 1400, mx: "auto" }}>{children}</Box>
          </Box>

          {dock && <Box sx={{ flexShrink: 0 }}>{dock}</Box>}
        </Box>

        {right && isLarge && (
          <Box
            sx={{
              // One column that animates its width between the sheet and
              // the rail; content crossfades, the toggle stays put.
              width: rightOpen ? { lg: 320, xl: 340 } : 56,
              flexShrink: 0,
              position: "relative",
              borderLeft: `1px solid ${m3.outlineVariant}`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transition: theme.transitions.create("width", { duration: theme.transitions.duration.standard }),
            }}
          >
            <Box
              sx={{
                width: { lg: 320, xl: 340 },
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                opacity: rightOpen ? 1 : 0,
                pointerEvents: rightOpen ? "auto" : "none",
                transition: theme.transitions.create("opacity", { duration: theme.transitions.duration.short }),
              }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, pt: 2, pb: 1, flexShrink: 0, pr: 7 }}>
                <Typography variant="overline" sx={{ color: "text.secondary", flex: 1 }}>
                  Player
                </Typography>
              </Stack>
              <Box sx={{ flex: 1, minHeight: 0, px: 2, pb: 2 }}>{right}</Box>
            </Box>

            <Box
              sx={{
                position: "absolute",
                top: 64,
                left: 0,
                right: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                opacity: rightOpen ? 0 : 1,
                pointerEvents: rightOpen ? "none" : "auto",
                transition: theme.transitions.create("opacity", { duration: theme.transitions.duration.short }),
              }}
            >
              <Tooltip title="Queue">
                <IconButton onClick={() => setRightOpen(true)} aria-label="Show queue">
                  <Badge badgeContent={rightBadge ?? 0} color="primary">
                    {Ic.queue}
                  </Badge>
                </IconButton>
              </Tooltip>
            </Box>

            <Tooltip title={rightOpen ? "Hide player sidebar" : "Show player sidebar"}>
              <IconButton
                onClick={() => setRightOpen(!rightOpen)}
                aria-label={rightOpen ? "Hide player sidebar" : "Show player sidebar"}
                sx={{ position: "absolute", top: 8, right: 8 }}
              >
                {rightOpen ? Ic.rightClose : Ic.rightOpen}
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Box>
  );
}
