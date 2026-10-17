import { type ReactNode, useCallback, useState } from "react";
import { Avatar, Badge, Box, Collapse, Divider, Drawer, IconButton, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Stack, Toolbar, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { Link as RouterLink, matchPath, useLocation } from "react-router-dom";
import { IconGraphicEq } from "./icons";
import { MsIcon } from "./MsIcon";
import type { GuildBrief, Me } from "../api";
import { api, guildAllows } from "../api";
import { useGuilds, useMe } from "../queries";
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
  disabled,
  onClick,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <Tooltip
      title={
        disabled
          ? collapsed
            ? `${label} — no access`
            : "You don't have access to this section"
          : collapsed
            ? label
            : undefined
      }
      placement="right"
      disableInteractive
    >
      <ListItemButton
        component={RouterLink}
        to={to}
        selected={pathname === to}
        disabled={disabled}
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
  onNavigate,
  onLogout,
}: {
  me: Me | null;
  guilds: GuildBrief[];
  guildsLoading: boolean;
  activeGuildId: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
  onLogout?: () => void;
}) {
  const botName = useBotName();
  // Every page gets logout through the drawer; a page may override it.
  const doLogout = onLogout ?? (() => api.logout().then(() => window.location.reload()));
  const active = guilds.find((g) => g.id === activeGuildId) ?? null;
  // Super-admin testing override for the current guild, if any.
  const meQuery = useMe();
  const activeMock = active ? meQuery.data?.access_mock?.[active.id] ?? null : null;
  // Secondary sections sit behind "Show more"; start expanded when the
  // current route already points into that group.
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(() => /\/(moderation|admin)$/.test(pathname));
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* The expand/collapse toggle lives in AppShell, pinned to the top
          right corner, so it does not move during the animation. */}
      <Toolbar sx={{ gap: 1.5, px: collapsed ? 1 : 2.5, pr: collapsed ? 1 : 7 }}>
        {!collapsed && (
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
              disabled={!guildAllows(active, "player")}
              onClick={onNavigate}
            />
            <GuildTab
              to={`/guild/${active.id}/stats`}
              icon={Ic.stats}
              label="Stats"
              collapsed={collapsed}
              disabled={!guildAllows(active, "stats")}
              onClick={onNavigate}
            />
            <GuildTab
              to={`/guild/${active.id}/posts`}
              icon={Ic.posts}
              label="Posts"
              collapsed={collapsed}
              disabled={!guildAllows(active, "posts")}
              onClick={onNavigate}
            />
            {/* Secondary sections live one click deeper so the rail stays
                short; the arrow turns as the group expands. */}
            <Tooltip
              title={collapsed ? (moreOpen ? "Show less" : "Show more") : undefined}
              placement="right"
              disableInteractive
            >
              <ListItemButton
                onClick={() => setMoreOpen(!moreOpen)}
                aria-expanded={moreOpen}
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
                  <MsIcon
                    name="keyboard_arrow_down"
                    sx={{
                      color: "text.secondary",
                      transform: moreOpen ? "rotate(180deg)" : "none",
                      transition: (t) =>
                        t.transitions.create("transform", { duration: t.transitions.duration.short }),
                    }}
                  />
                </ListItemIcon>
                {!collapsed && (
                  <ListItemText
                    primary={moreOpen ? "Show less" : "Show more"}
                    slotProps={{ primary: { noWrap: true, variant: "body1" } }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
            <Collapse in={moreOpen}>
              <GuildTab
                to={`/guild/${active.id}/moderation`}
                icon={Ic.moderation}
                label="Moderation"
                collapsed={collapsed}
                disabled={!guildAllows(active, "moderation")}
                onClick={onNavigate}
              />
              <GuildTab
                to={`/guild/${active.id}/admin`}
                icon={Ic.settings}
                label="Manage"
                collapsed={collapsed}
                disabled={!guildAllows(active, "manage")}
                onClick={onNavigate}
              />
            </Collapse>
            {activeMock && !collapsed && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2.75, pt: 0.5 }}>
                <MsIcon name="switch_account" fontSize={16} sx={{ color: "secondary.main" }} />
                <Typography variant="caption" sx={{ color: "secondary.main" }}>
                  Previewing as {activeMock}
                </Typography>
              </Stack>
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
              slotProps={{ primary: { noWrap: true, variant: "body1" }, secondary: { noWrap: true } }}
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
        // Slimmer inset on phones: screen width is scarce there.
        p: { xs: 1, md: 2 },
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
          borderRadius: { xs: "16px", md: "24px" },
          overflow: "hidden",
          display: "flex",
        }}
      >
        {isWide && (
          <Box
            sx={{
              // One column animating between the drawer and the rail; the
              // expanded content and the rail crossfade instead of
              // reflowing, like the player sheet on the right.
              width: navWidth,
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
              borderRight: `1px solid ${m3.outlineVariant}`,
              transition: theme.transitions.create("width", { duration: theme.transitions.duration.standard }),
            }}
          >
            <Box
              sx={{
                width: DRAWER_WIDTH,
                height: "100%",
                opacity: navCollapsed ? 0 : 1,
                pointerEvents: navCollapsed ? "none" : "auto",
                transition: theme.transitions.create("opacity", { duration: theme.transitions.duration.short }),
              }}
            >
              <DrawerContent
                me={me}
                guilds={guilds}
                guildsLoading={guildsLoading}
                activeGuildId={activeGuildId}
                collapsed={false}
                onLogout={onLogout}
              />
            </Box>
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                justifyContent: "center",
                opacity: navCollapsed ? 1 : 0,
                pointerEvents: navCollapsed ? "auto" : "none",
                transition: theme.transitions.create("opacity", { duration: theme.transitions.duration.short }),
              }}
            >
              <Box sx={{ width: DRAWER_RAIL_WIDTH, height: "100%" }}>
                <DrawerContent
                  me={me}
                  guilds={guilds}
                  guildsLoading={guildsLoading}
                  activeGuildId={activeGuildId}
                  collapsed
                  onLogout={onLogout}
                />
              </Box>
            </Box>
            <Tooltip title={navCollapsed ? "Expand navigation" : "Collapse menu"}>
              <IconButton
                onClick={() => setNavCollapsed(!navCollapsed)}
                aria-label={navCollapsed ? "Expand navigation" : "Collapse menu"}
                sx={{
                  position: "absolute",
                  top: 8,
                  // Corner of the expanded drawer, centered in the rail —
                  // the offset glides with the width animation.
                  right: navCollapsed ? 20 : 8,
                  transition: theme.transitions.create(["right", "background-color"], {
                    duration: theme.transitions.duration.standard,
                  }),
                }}
              >
                {navCollapsed ? Ic.leftOpen : Ic.leftClose}
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Page header: typography on the frame surface, no bar panel.
              Shares the centered content width so the title lines up with
              the page column on wide screens. */}
          <Box sx={{ px: { xs: 1.5, md: 3 }, pt: { xs: 1.5, md: 2 }, pb: { xs: 1, md: 1.5 }, flexShrink: 0 }}>
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
            {/* The only page title in the app: everything else uses the
                card-level h6 from the theme. */}
            <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 22, fontWeight: 500, lineHeight: 1.3 }}>
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
          <Box
            component="main"
            sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 1.5, md: 3 }, pb: { xs: 2, md: 3 } }}
          >
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
