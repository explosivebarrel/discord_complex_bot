import { type ReactNode } from "react";
import { AppBar, Avatar, Box, Container, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import GraphicEq from "@mui/icons-material/GraphicEq";
import Settings from "@mui/icons-material/Settings";
import Logout from "@mui/icons-material/Logout";
import type { Me } from "../api";

export function AppShell({
  me,
  title,
  onLogout,
  children,
}: {
  me: Me | null;
  title?: string;
  onLogout?: () => void;
  children: ReactNode;
}) {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="fixed" elevation={0} sx={{ bgcolor: "#211F26", borderBottom: "1px solid #2B2930" }}>
        <Toolbar sx={{ gap: 1.5 }}>
          <GraphicEq sx={{ color: "primary.main" }} />
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "inherit", textDecoration: "none" }}
          >
            discord_complex_bot{title ? ` — ${title}` : ""}
          </Typography>
          {me?.is_superadmin && (
            <Tooltip title="System settings">
              <IconButton href="/settings" size="small">
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
