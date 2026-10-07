import { type ReactNode } from "react";
import { AppBar, Avatar, Box, Container, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import ArrowBack from "@mui/icons-material/ArrowBack";
import GraphicEq from "@mui/icons-material/GraphicEq";
import Home from "@mui/icons-material/Home";
import Settings from "@mui/icons-material/Settings";
import Logout from "@mui/icons-material/Logout";
import type { Me } from "../api";

export function AppShell({
  me,
  title,
  back,
  onLogout,
  children,
}: {
  me: Me | null;
  title?: string;
  /** Show a back arrow that leads to the home page. */
  back?: boolean;
  onLogout?: () => void;
  children: ReactNode;
}) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="fixed" elevation={0} sx={{ bgcolor: "#211F26", borderBottom: "1px solid #2B2930" }}>
        <Toolbar sx={{ gap: 1.5 }}>
          {back && (
            <Tooltip title="Back to servers">
              <IconButton component={RouterLink} to="/" size="small">
                <ArrowBack />
              </IconButton>
            </Tooltip>
          )}
          <Box
            component={RouterLink}
            to="/"
            sx={{ display: "flex", alignItems: "center", gap: 1.5, textDecoration: "none", color: "inherit", minWidth: 0 }}
          >
            <GraphicEq sx={{ color: "primary.main" }} />
            <Typography
              variant="h6"
              noWrap
              sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", "&:hover": { color: "primary.main" } }}
            >
              discord_complex_bot{title ? ` — ${title}` : ""}
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {me && (
            <Tooltip title="Home">
              <IconButton component={RouterLink} to="/" size="small">
                <Home />
              </IconButton>
            </Tooltip>
          )}
          {me?.is_superadmin && (
            <Tooltip title="System settings">
              <IconButton component={RouterLink} to="/settings" size="small">
                <Settings />
              </IconButton>
            </Tooltip>
          )}
          {me && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="body2" sx={{ color: "text.secondary", display: { xs: "none", sm: "block" } }}>
                {me.global_name}
              </Typography>
              <Avatar src={me.avatar_url} sx={{ width: 30, height: 30 }} />
              {onLogout && (
                <Tooltip title="Logout">
                  <IconButton size="small" onClick={onLogout}>
                    <Logout />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ flex: 1, pt: { xs: 10, sm: 11 }, pb: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
