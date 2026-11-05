import { useState } from "react";
import {
  Avatar,
  Box,
  IconButton,
  ListItemIcon,
  ListItemButton,
  ListItemText,
  Menu,
  Tooltip,
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { api, type Me } from "../api";
import { MsIcon } from "./MsIcon";

const Ic = {
  about: <MsIcon name="info" fontSize={20} />,
  extension: <MsIcon name="extension" fontSize={20} />,
  settings: <MsIcon name="settings" fontSize={20} />,
  logout: <MsIcon name="logout" fontSize={20} />,
};

function AccountMenuBody({
  me,
  onClose,
  onLogout,
}: {
  me: Me;
  onClose: () => void;
  onLogout?: () => void;
}) {
  const doLogout = onLogout ?? (() => api.logout().then(() => window.location.reload()));
  return (
    <>
      <Box sx={{ px: 2, py: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 200 }}>
          <Avatar src={me.avatar_url} sx={{ width: 34, height: 34 }} />
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {me.global_name}
            </Box>
            <Box sx={{ fontSize: 12, color: "text.secondary" }}>@{me.discord_id}</Box>
          </Box>
        </Box>
      </Box>
      <ListItemButton component={RouterLink} to="/about" onClick={onClose}>
        <ListItemIcon>{Ic.about}</ListItemIcon>
        <ListItemText primary="About" />
      </ListItemButton>
      <ListItemButton component={RouterLink} to="/extension" onClick={onClose}>
        <ListItemIcon>{Ic.extension}</ListItemIcon>
        <ListItemText primary="Add from sites" />
      </ListItemButton>
      {me.is_superadmin && (
        <ListItemButton component={RouterLink} to="/settings" onClick={onClose}>
          <ListItemIcon>{Ic.settings}</ListItemIcon>
          <ListItemText primary="System settings" />
        </ListItemButton>
      )}
      <ListItemButton
        onClick={() => {
          onClose();
          doLogout();
        }}
      >
        <ListItemIcon>{Ic.logout}</ListItemIcon>
        <ListItemText primary="Logout" />
      </ListItemButton>
    </>
  );
}

/** The sidebar account entry: clicking the avatar (rail) or the name row
    (expanded) opens the menu with About / System settings / Logout. */
export function AccountMenu({
  me,
  collapsed,
  onLogout,
}: {
  me: Me;
  collapsed: boolean;
  onLogout?: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  if (collapsed) {
    return (
      <>
        <Tooltip title={`${me.global_name} — menu`} placement="right" disableInteractive>
          <IconButton
            onClick={(e) => setAnchor(e.currentTarget)}
            aria-label="Account menu"
            sx={{ mx: "auto", display: "flex", mb: 0.5 }}
          >
            <Avatar src={me.avatar_url} sx={{ width: 30, height: 30, fontSize: 13 }} />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
          <AccountMenuBody me={me} onClose={close} onLogout={onLogout} />
        </Menu>
      </>
    );
  }

  return (
    <>
      <ListItemButton
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2, minHeight: 44 }}
        aria-label="Account menu"
      >
        <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>
          <Avatar src={me.avatar_url} sx={{ width: 26, height: 26, fontSize: 13 }} />
        </ListItemIcon>
        <ListItemText
          primary={me.global_name}
          secondary="Account"
          slotProps={{ primary: { noWrap: true, variant: "body1" }, secondary: { noWrap: true } }}
        />
        <Box sx={{ color: "text.secondary", mr: 0.5, display: "flex" }}>
          <MsIcon name="keyboard_arrow_down" fontSize={20} />
        </Box>
      </ListItemButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close}>
        <AccountMenuBody me={me} onClose={close} onLogout={onLogout} />
      </Menu>
    </>
  );
}
