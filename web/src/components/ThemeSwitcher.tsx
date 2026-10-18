import { useState } from "react";
import { Box, Divider, IconButton, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { useAppTheme } from "../themes/AppThemeContext";
import { ADVANCED_SCHEMES, BASE_SCHEMES, type AppThemeScheme } from "../themes/palettes";
import { IconCheck, IconPalette } from "./icons";

/** Half primary / half surface circle: a compact preview of a theme. */
function Swatch({ scheme }: { scheme: AppThemeScheme }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        flexShrink: 0,
        border: "1px solid",
        borderColor: "divider",
        background: `linear-gradient(135deg, ${scheme.tokens.primary} 0%, ${scheme.tokens.primary} 50%, ${scheme.tokens.surface} 50%, ${scheme.tokens.surface} 100%)`,
      }}
    />
  );
}

function ThemeMenu({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const { scheme, setThemeId } = useAppTheme();
  const item = (s: AppThemeScheme) => (
    <MenuItem
      key={s.id}
      selected={s.id === scheme.id}
      onClick={() => {
        setThemeId(s.id);
        onClose();
      }}
    >
      <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>
        <Swatch scheme={s} />
      </ListItemIcon>
      <ListItemText primary={s.label} slotProps={{ primary: { noWrap: true } }} />
      {s.id === scheme.id && <IconCheck fontSize={18} sx={{ color: "primary.main" }} />}
    </MenuItem>
  );
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose} slotProps={{ paper: { sx: { maxHeight: 460 } } }}>
      {BASE_SCHEMES.map(item)}
      <Divider />
      <Typography variant="overline" sx={{ px: 2, display: "block", color: "text.secondary" }}>
        Advanced
      </Typography>
      {ADVANCED_SCHEMES.map(item)}
    </Menu>
  );
}

/** Bottom-of-sidebar theme picker: labeled row in the drawer, icon in the rail. */
export function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { scheme } = useAppTheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menu = <ThemeMenu anchor={anchor} onClose={() => setAnchor(null)} />;
  if (collapsed) {
    return (
      <>
        <Tooltip title={`Palette: ${scheme.label}`} placement="right" disableInteractive>
          <IconButton
            aria-label="Switch theme"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ mx: "auto", display: "flex", mb: 0.5 }}
          >
            <IconPalette fontSize={22} />
          </IconButton>
        </Tooltip>
        {menu}
      </>
    );
  }
  return (
    <>
      <ListItemButton
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2, minHeight: 44 }}
      >
        <ListItemIcon sx={{ minWidth: 40 }}>
          <IconPalette fontSize={20} />
        </ListItemIcon>
        <ListItemText
          primary="Palette"
          secondary={scheme.label}
          slotProps={{ primary: { noWrap: true, variant: "body1" }, secondary: { noWrap: true } }}
        />
      </ListItemButton>
      {menu}
    </>
  );
}
